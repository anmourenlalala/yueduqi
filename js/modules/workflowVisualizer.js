/**
 * 工作流可视化模块
 * 负责工作流关系图的可视化和编辑
 */

import { state } from '../core/state.js';
import { parseWorkflowFormat, generateWorkflowFormat } from './workflowManager.js';

let workflowGraph = {
    nodes: [], // {id: string, x: number, y: number, viewId: string, workflowId: string|null, nodeType: 'view'|'workflow'}
    edges: []  // {from: string, to: string, edgeType: 'view'|'workflow'}
};

let selectedNode = null;
let isDragging = false;
let isPanning = false; // 是否正在平移画布
let dragOffset = { x: 0, y: 0 };
let panStartOffset = { x: 0, y: 0 }; // 平移开始时的偏移
let mouseDownPos = { x: 0, y: 0 };
let hasMoved = false;
let hoveredNode = null; // 当前鼠标悬浮的节点
let isAddingNode = false; // 是否正在添加节点（防止重复弹出选择器）
let isAltDragging = false; // 是否正在Alt+拖拽连接节点
let dragSourceNode = null; // Alt+拖拽时的源节点
let dragTargetNode = null; // Alt+拖拽时的目标节点
let dragMousePos = { x: 0, y: 0 }; // Alt+拖拽时的鼠标位置

// 缩放相关变量
let zoomScale = 1.0; // 缩放比例
let panOffset = { x: 0, y: 0 }; // 平移偏移

/**
 * 初始化工作流可视化
 */
export function initWorkflowVisualizer() {
    const canvas = document.getElementById('workflow-canvas');
    if (!canvas) return;
    
    // 重置缩放和平移
    zoomScale = 1.0;
    panOffset = { x: 0, y: 0 };
    
    // 设置canvas大小
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    
    // 绑定事件
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('click', handleCanvasClick);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    
    // 绑定键盘事件（Delete键删除节点）
    canvas.addEventListener('keydown', handleKeyDown);
    canvas.setAttribute('tabindex', '0'); // 使canvas可以接收键盘事件
    
    // 检查工作流内容是否为空，如果为空则创建默认节点
    const contentInput = document.getElementById('workflow-content');
    if (contentInput && !contentInput.value.trim()) {
        // 创建默认节点
        workflowGraph.nodes = [];
        workflowGraph.edges = [];
        const defaultNode = {
            id: 'node_0',
            x: canvas.width / 2 - 50,
            y: canvas.height / 2 - 25,
            viewId: '测试'
        };
        workflowGraph.nodes.push(defaultNode);
        updateWorkflowContent(); // 更新内容为默认格式
        renderWorkflowGraph();
    } else if (contentInput && contentInput.value.trim()) {
        // 如果有内容，从内容解析
        renderWorkflowFromContent(contentInput.value);
    } else {
        // 绘制初始图形
        renderWorkflowGraph();
    }
}

/**
 * 从工作流内容解析并渲染关系图
 */
export function renderWorkflowFromContent(workflowContent) {
    // 如果内容为空，创建默认节点
    if (!workflowContent || !workflowContent.trim()) {
        const canvas = document.getElementById('workflow-canvas');
        if (canvas) {
            workflowGraph.nodes = [];
            workflowGraph.edges = [];
            const defaultNode = {
                id: 'node_0',
                x: canvas.width / 2 - 50,
                y: canvas.height / 2 - 25,
                viewId: '测试',
                workflowId: null,
                nodeType: 'view'
            };
            workflowGraph.nodes.push(defaultNode);
            updateWorkflowContent(); // 更新内容为默认格式
            renderWorkflowGraph();
            return;
        }
    }
    
    const steps = parseWorkflowFormat(workflowContent);
    
    // 如果解析结果为空，创建默认节点
    if (steps.length === 0) {
        const canvas = document.getElementById('workflow-canvas');
        if (canvas) {
            workflowGraph.nodes = [];
            workflowGraph.edges = [];
            const defaultNode = {
                id: 'node_0',
                x: canvas.width / 2 - 50,
                y: canvas.height / 2 - 25,
                viewId: '测试',
                workflowId: null,
                nodeType: 'view'
            };
            workflowGraph.nodes.push(defaultNode);
            updateWorkflowContent(); // 更新内容为默认格式
            renderWorkflowGraph();
            return;
        }
    }
    
    // 重置图形
    workflowGraph.nodes = [];
    workflowGraph.edges = [];
    
    // 创建节点（使用新格式的x、y坐标）
    const nodeMap = new Map();
    steps.forEach((step, index) => {
        const nodeId = `node_${index}`;
        // 使用新格式的x、y坐标，如果没有则使用默认布局
        const nodeX = step.x !== undefined ? 200 + step.x * 200 : (200 + (index % 3) * 200);
        const nodeY = step.y !== undefined ? 150 + step.y * 150 : (150 + Math.floor(index / 3) * 150);
        
        const viewId = step.viewId || step.self || '测试';
        let workflowId = step.workflowId || null;
        
        // 关键修复：如果workflowId为空，检查viewId是否是工作流名称
        // 如果viewId存在于工作流列表中，说明这是一个工作流节点
        let actualWorkflowId = workflowId;
        let actualNodeType = workflowId ? 'workflow' : 'view';
        
        if (!workflowId && state.workflows && state.workflows.length > 0) {
            const workflowExists = state.workflows.some(w => w.name === viewId);
            if (workflowExists) {
                actualWorkflowId = viewId; // 将viewId作为workflowId
                actualNodeType = 'workflow';
            }
        }
        
        const node = {
            id: nodeId,
            x: nodeX,
            y: nodeY,
            viewId: actualNodeType === 'workflow' ? null : viewId, // 工作流节点的viewId设为null
            workflowId: actualWorkflowId, // 工作流节点的workflowId设置为工作流名称
            nodeType: actualNodeType,
            _x: step.x !== undefined ? step.x : (Math.floor((nodeX - 200) / 200)),
            _y: step.y !== undefined ? step.y : (Math.floor((nodeY - 150) / 150))
        };
        workflowGraph.nodes.push(node);
        // 使用viewId或workflowId作为映射key
        if (actualNodeType === 'workflow' && actualWorkflowId) {
            nodeMap.set(actualWorkflowId, node);
        } else if (viewId) {
            nodeMap.set(viewId, node);
        }
    });
    
    // 创建步骤坐标到节点的映射（用于根据坐标快速查找节点）
    const stepToNode = new Map(); // "x,y" -> node
    workflowGraph.nodes.forEach((node, index) => {
        const key = `${node._x},${node._y}`;
        stepToNode.set(key, node);
    });
    
    // 创建节点到步骤的映射
    const nodeToStep = new Map(); // nodeId -> step
    steps.forEach((step, index) => {
        const key = `${step.x},${step.y}`;
        const node = stepToNode.get(key);
        if (node) {
            nodeToStep.set(node.id, step);
        }
    });
    
    // 创建边（根据步骤的viewPrev和viewNext关系）
    const edgeSet = new Set();
    
    // 按y、x轴顺序排序步骤（先按y排序，再按x排序）
    const sortedSteps = [...steps].sort((a, b) => {
        if (a.y !== b.y) return a.y - b.y;
        return a.x - b.x;
    });
    
    sortedSteps.forEach((step, stepIndex) => {
        const key = `${step.x},${step.y}`;
        const currentNode = stepToNode.get(key);
        if (!currentNode) return;
        
        // 处理viewPrev：从前驱节点指向当前节点
        const viewPrev = step.viewPrev || step.prev || [];
        viewPrev.forEach(prevId => {
            // 在所有步骤中查找viewId匹配且坐标在当前的步骤之前的节点
            for (let i = 0; i < stepIndex; i++) {
                const prevStep = sortedSteps[i];
                if (prevStep.viewId === prevId) {
                    const prevKey = `${prevStep.x},${prevStep.y}`;
                    const prevNode = stepToNode.get(prevKey);
                    if (prevNode) {
                        const edgeKey = `${prevNode.id}-${currentNode.id}-view`;
                        if (!edgeSet.has(edgeKey)) {
                            workflowGraph.edges.push({
                                from: prevNode.id,
                                to: currentNode.id,
                                edgeType: 'view',
                                fromViewId: prevStep.viewId,
                                toViewId: step.viewId
                            });
                            edgeSet.add(edgeKey);
                        }
                    }
                }
            }
        });
        
        // 处理viewNext：从当前节点指向后继节点
        // 关键修复：只有当viewNext不为空时才处理连线，避免连接到错误的节点
        const viewNext = step.viewNext || step.next || [];
        // 关键修复：如果viewNext为空数组，说明下一节点是(0)(0)[无]，不应该创建任何连线
        if (viewNext.length > 0) {
            viewNext.forEach(nextId => {
                // 在所有步骤中查找viewId匹配的节点，为每个匹配的节点创建边
            // 关键修复：优先查找距离当前步骤最近的匹配节点（按y坐标排序）
            const matchingSteps = [];
            for (let i = stepIndex + 1; i < sortedSteps.length; i++) {
                const nextStep = sortedSteps[i];
                // 关键修复：不仅要匹配viewId，还要确保nextStep的坐标在当前步骤之后
                // 即nextStep的y坐标应该大于等于当前步骤的y坐标（或者y相同但x不同表示并行）
                if (nextStep.viewId === nextId) {
                    // 关键修复：只连接在时间顺序上在当前步骤之后的节点
                    // 如果nextStep的y小于当前步骤的y，说明它应该在前，不应该连接
                    if (nextStep.y >= step.y) {
                        matchingSteps.push(nextStep);
                    }
                }
            }
            
            // 关键修复：如果找到匹配的节点，只连接到y坐标最小的那个（即最近的下一节点）
            // 这样避免连接到更后面的同名节点
            if (matchingSteps.length > 0) {
                // 按y坐标排序，取y最小的，如果y相同则取x最小的
                matchingSteps.sort((a, b) => {
                    if (a.y !== b.y) return a.y - b.y;
                    return a.x - b.x;
                });
                const nextStep = matchingSteps[0];
                const nextKey = `${nextStep.x},${nextStep.y}`;
                const nextNode = stepToNode.get(nextKey);
                if (nextNode) {
                    const edgeKey = `${currentNode.id}-${nextNode.id}-view`;
                    if (!edgeSet.has(edgeKey)) {
                        workflowGraph.edges.push({
                            from: currentNode.id,
                            to: nextNode.id,
                            edgeType: 'view',
                            fromViewId: step.viewId,
                            toViewId: nextStep.viewId
                        });
                        edgeSet.add(edgeKey);
                    }
                }
            }
            });
        }
        
        // 处理workflowPrev和workflowNext（类似逻辑）
        if (step.workflowId) {
            const workflowPrev = step.workflowPrev || [];
            workflowPrev.forEach(prevWorkflowId => {
                for (let i = 0; i < stepIndex; i++) {
                    const prevStep = sortedSteps[i];
                    if (prevStep.workflowId === prevWorkflowId) {
                        const prevKey = `${prevStep.x},${prevStep.y}`;
                        const prevNode = stepToNode.get(prevKey);
                        if (prevNode) {
                            const edgeKey = `${prevNode.id}-${currentNode.id}-workflow`;
                            if (!edgeSet.has(edgeKey)) {
                                workflowGraph.edges.push({
                                    from: prevNode.id,
                                    to: currentNode.id,
                                    edgeType: 'workflow',
                                    fromWorkflowId: prevStep.workflowId,
                                    toWorkflowId: step.workflowId
                                });
                                edgeSet.add(edgeKey);
                            }
                        }
                    }
                }
            });
            
            const workflowNext = step.workflowNext || [];
            // 关键修复：如果workflowNext为空数组，说明下一节点是(0)(0)[无]，不应该创建任何连线
            if (workflowNext.length > 0) {
                workflowNext.forEach(nextWorkflowId => {
                    // 为所有匹配的工作流节点创建边
                    for (let i = stepIndex + 1; i < sortedSteps.length; i++) {
                        const nextStep = sortedSteps[i];
                        if (nextStep.workflowId === nextWorkflowId) {
                            // 关键修复：只连接在时间顺序上在当前步骤之后的节点
                            if (nextStep.y < step.y) {
                                continue; // 跳过应该在前面的节点
                            }
                            const nextKey = `${nextStep.x},${nextStep.y}`;
                            const nextNode = stepToNode.get(nextKey);
                            if (nextNode) {
                                const edgeKey = `${currentNode.id}-${nextNode.id}-workflow`;
                                if (!edgeSet.has(edgeKey)) {
                                    workflowGraph.edges.push({
                                        from: currentNode.id,
                                        to: nextNode.id,
                                        edgeType: 'workflow',
                                        fromWorkflowId: step.workflowId,
                                        toWorkflowId: nextStep.workflowId
                                    });
                                    edgeSet.add(edgeKey);
                                }
                            }
                        }
                    }
                });
            }
        }
    });
    
    // 对边进行排序（按y、x轴顺序）
    workflowGraph.edges.sort((a, b) => {
        const aFrom = workflowGraph.nodes.find(n => n.id === a.from);
        const bFrom = workflowGraph.nodes.find(n => n.id === b.from);
        if (!aFrom || !bFrom) return 0;
        if (aFrom._y !== bFrom._y) return aFrom._y - bFrom._y;
        if (aFrom._x !== bFrom._x) return aFrom._x - bFrom._x;
        const aTo = workflowGraph.nodes.find(n => n.id === a.to);
        const bTo = workflowGraph.nodes.find(n => n.id === b.to);
        if (!aTo || !bTo) return 0;
        if (aTo._y !== bTo._y) return aTo._y - bTo._y;
        return aTo._x - bTo._x;
    });
    
    renderWorkflowGraph();
}

/**
 * 将屏幕坐标转换为画布坐标（考虑缩放和平移）
 */
function screenToCanvas(screenX, screenY) {
    return {
        x: (screenX - panOffset.x) / zoomScale,
        y: (screenY - panOffset.y) / zoomScale
    };
}

/**
 * 将画布坐标转换为屏幕坐标
 */
function canvasToScreen(canvasX, canvasY) {
    return {
        x: canvasX * zoomScale + panOffset.x,
        y: canvasY * zoomScale + panOffset.y
    };
}

/**
 * 计算从矩形中心到边缘的交点（考虑角度）
 * @param {number} centerX - 矩形中心X坐标
 * @param {number} centerY - 矩形中心Y坐标
 * @param {number} width - 矩形宽度
 * @param {number} height - 矩形高度
 * @param {number} angle - 从中心出发的角度（弧度）
 * @param {number} padding - 额外的间距
 * @returns {Object} 交点坐标 {x, y}
 */
function getRectangleEdgeIntersection(centerX, centerY, width, height, angle, padding = 0) {
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    
    // 计算方向向量
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    
    // 处理特殊情况：dx 或 dy 为 0
    if (Math.abs(dx) < 1e-10) {
        // 垂直方向
        if (dy > 0) {
            return { x: centerX, y: centerY + halfHeight + padding };
        } else {
            return { x: centerX, y: centerY - halfHeight - padding };
        }
    }
    if (Math.abs(dy) < 1e-10) {
        // 水平方向
        if (dx > 0) {
            return { x: centerX + halfWidth + padding, y: centerY };
        } else {
            return { x: centerX - halfWidth - padding, y: centerY };
        }
    }
    
    // 计算到四个边的距离参数 t
    // 右边界: x = centerX + halfWidth
    const tRight = dx > 0 ? (halfWidth + padding) / dx : Infinity;
    // 左边界: x = centerX - halfWidth
    const tLeft = dx < 0 ? (halfWidth + padding) / -dx : Infinity;
    // 下边界: y = centerY + halfHeight
    const tBottom = dy > 0 ? (halfHeight + padding) / dy : Infinity;
    // 上边界: y = centerY - halfHeight
    const tTop = dy < 0 ? (halfHeight + padding) / -dy : Infinity;
    
    // 找到最小的正数t值（最近的边界）
    const t = Math.min(tRight, tLeft, tBottom, tTop);
    
    // 计算交点
    return {
        x: centerX + dx * t,
        y: centerY + dy * t
    };
}

/**
 * 渲染工作流关系图
 */
function renderWorkflowGraph() {
    const canvas = document.getElementById('workflow-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 保存当前状态
    ctx.save();
    
    // 应用缩放和平移
    ctx.translate(panOffset.x, panOffset.y);
    ctx.scale(zoomScale, zoomScale);
    
    // 计算节点的执行步骤（拓扑排序）- 需要在绘制边之前计算，因为绘制边时会用到
    const nodeSteps = calculateNodeSteps();
    
    // 先统计连接到每个节点的边，用于分散箭头
    const edgesToNode = new Map(); // nodeId -> edges[]
    const edgesFromNode = new Map(); // nodeId -> edges[]
    
    workflowGraph.edges.forEach(edge => {
        // 统计指向目标节点的边
        if (!edgesToNode.has(edge.to)) {
            edgesToNode.set(edge.to, []);
        }
        edgesToNode.get(edge.to).push(edge);
        
        // 统计从源节点出发的边
        if (!edgesFromNode.has(edge.from)) {
            edgesFromNode.set(edge.from, []);
        }
        edgesFromNode.get(edge.from).push(edge);
    });
    
    // 绘制边（区分视图边和工作流边）
    workflowGraph.edges.forEach((edge, edgeIndex) => {
        const fromNode = workflowGraph.nodes.find(n => n.id === edge.from);
        const toNode = workflowGraph.nodes.find(n => n.id === edge.to);
        if (fromNode && toNode) {
            // 根据边类型选择颜色
            const edgeColor = edge.edgeType === 'workflow' ? '#fbbf24' : '#475569';
            ctx.strokeStyle = edgeColor;
            ctx.fillStyle = edgeColor;
            ctx.lineWidth = 2 / zoomScale;
            
            // 节点尺寸
            const nodeWidth = 100;
            const nodeHeight = 50;
            const nodePadding = 2; // 节点边框外的距离
            
            // 计算线条的起点和终点（节点中心点）
            const fromCenterX = fromNode.x + nodeWidth / 2;
            const fromCenterY = fromNode.y + nodeHeight / 2;
            const toCenterX = toNode.x + nodeWidth / 2;
            const toCenterY = toNode.y + nodeHeight / 2;
            
            // 计算基础角度和距离
            const dx = toCenterX - fromCenterX;
            const dy = toCenterY - fromCenterY;
            const baseAngle = Math.atan2(dy, dx);
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // 计算箭头分散角度（如果有多个箭头指向同一个节点）
            const edgesToTarget = edgesToNode.get(edge.to) || [];
            const sameTypeEdgesToTarget = edgesToTarget.filter(e => e.edgeType === edge.edgeType);
            // 按y、x轴顺序排序这些边
            sameTypeEdgesToTarget.sort((a, b) => {
                const aFrom = workflowGraph.nodes.find(n => n.id === a.from);
                const bFrom = workflowGraph.nodes.find(n => n.id === b.from);
                if (!aFrom || !bFrom) return 0;
                if (aFrom._y !== bFrom._y) return aFrom._y - bFrom._y;
                return aFrom._x - bFrom._x;
            });
            const edgeIndexInGroup = sameTypeEdgesToTarget.findIndex(e => e.from === edge.from && e.to === edge.to);
            const totalEdges = sameTypeEdgesToTarget.length;
            
            // 如果有多条边指向同一个节点，计算分散角度
            let angleOffset = 0;
            if (totalEdges > 1) {
                // 最大分散角度（弧度），约20度
                const maxSpreadAngle = Math.PI / 9;
                // 计算当前边应该偏移的角度
                const spreadRange = maxSpreadAngle * 2;
                const step = spreadRange / (totalEdges - 1);
                angleOffset = -maxSpreadAngle + step * edgeIndexInGroup;
            }
            
            const angle = baseAngle + angleOffset;
            
            // 计算节点边框上的交点（使用精确的矩形边缘计算）
            // 从源节点中心出发，沿着角度方向找到边框交点
            const fromIntersection = getRectangleEdgeIntersection(
                fromCenterX, fromCenterY, nodeWidth, nodeHeight, baseAngle, nodePadding
            );
            const fromBorderX = fromIntersection.x;
            const fromBorderY = fromIntersection.y;
            
            // 从目标节点中心出发，沿着角度方向找到边框交点（考虑角度偏移）
            // 注意：目标节点使用反向角度（angle + π）
            const toIntersection = getRectangleEdgeIntersection(
                toCenterX, toCenterY, nodeWidth, nodeHeight, angle + Math.PI, nodePadding
            );
            const toBorderX = toIntersection.x;
            const toBorderY = toIntersection.y;
            
            // 绘制线条（从源节点边框到目标节点边框）
            ctx.beginPath();
            ctx.moveTo(fromBorderX, fromBorderY);
            ctx.lineTo(toBorderX, toBorderY);
            ctx.stroke();
            
            // 绘制黑色实心圆（在目标节点边框上）
            const circleRadius = 5 / zoomScale;
            const originalFillStyle = ctx.fillStyle; // 保存原始填充色
            ctx.fillStyle = '#000000'; // 黑色
            ctx.beginPath();
            ctx.arc(toBorderX, toBorderY, circleRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = originalFillStyle; // 恢复原始填充色
            
            // 绘制标签（上一id步骤X 箭头 下一id步骤Y）
            // 获取步骤号（基于y轴）
            const fromStepNumber = nodeSteps.get(fromNode.id) || 0;
            const toStepNumber = nodeSteps.get(toNode.id) || 0;
            
            // 根据y轴比较决定箭头方向（相对于当前节点的y轴）
            // 如果目标节点y轴小于当前节点（在时间线之前），显示上箭头；如果大于（在时间线之后），显示下箭头
            const yArrow = fromNode._y < toNode._y ? '⬇' : (fromNode._y > toNode._y ? '⬆' : '');
            
            const fromViewId = edge.fromViewId || fromNode.viewId || '';
            const toViewId = edge.toViewId || toNode.viewId || '';
            const fromWorkflowId = edge.fromWorkflowId || fromNode.workflowId || '';
            const toWorkflowId = edge.toWorkflowId || toNode.workflowId || '';
            
            // 检查是否存在双向边（反向边）
            const reverseEdge = workflowGraph.edges.find(e => 
                e.from === edge.to && 
                e.to === edge.from && 
                e.edgeType === edge.edgeType
            );
            const isBidirectional = !!reverseEdge;
            
            // 构建标签文本（只显示上一个id）
            let fromLabelText = '';
            if (edge.edgeType === 'workflow') {
                if (fromWorkflowId) {
                    fromLabelText = `${fromWorkflowId}步骤${fromStepNumber}`;
                }
            } else {
                if (fromViewId) {
                    fromLabelText = `${fromViewId}步骤${fromStepNumber}`;
                }
            }
            
            if (fromLabelText) {
                // 计算标签位置（线条中点）
                const labelX = (fromBorderX + toBorderX) / 2;
                const labelY = (fromBorderY + toBorderY) / 2;
                
                // 计算线条的垂直方向（用于确定上标和下标的位置）
                const lineAngle = Math.atan2(toBorderY - fromBorderY, toBorderX - fromBorderX);
                const perpendicularAngle = lineAngle + Math.PI / 2; // 垂直于线条的角度
                
                // 字体大小15px
                const fontSize = 15 / zoomScale;
                const labelPaddingX = 12 / zoomScale; // 水平内边距（增大）
                const labelPaddingY = 8 / zoomScale; // 垂直内边距（增大）
                const offsetFromLine = 15 / zoomScale; // 标签距离线条的垂直距离
                
                // 设置字体
                ctx.font = `${fontSize}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle'; // 改为middle，方便垂直居中
                
                // 计算文本宽度
                const textMetrics = ctx.measureText(fromLabelText);
                const textWidth = textMetrics.width;
                
                // 计算标签位置
                // 对于双向边，需要调整位置避免重叠
                let offsetX = 0;
                let offsetY = 0;
                if (isBidirectional) {
                    // 双向边时，根据边的索引决定偏移方向
                    // 找到当前边和反向边在edges数组中的索引
                    const currentEdgeIndex = workflowGraph.edges.indexOf(edge);
                    const reverseEdgeIndex = workflowGraph.edges.indexOf(reverseEdge);
                    // 索引较小的边显示在右侧，索引较大的边显示在左侧
                    const sideOffset = currentEdgeIndex < reverseEdgeIndex ? offsetFromLine : -offsetFromLine;
                    offsetX = Math.cos(perpendicularAngle) * sideOffset;
                    offsetY = Math.sin(perpendicularAngle) * sideOffset;
                }
                
                // 计算标签位置（显示在线上方，垂直于线条向上）
                const labelOffsetX = -Math.cos(perpendicularAngle) * offsetFromLine;
                const labelOffsetY = -Math.sin(perpendicularAngle) * offsetFromLine;
                const finalLabelX = labelX + offsetX + labelOffsetX;
                const finalLabelY = labelY + offsetY + labelOffsetY;
                
                // 计算背景区域（增大尺寸）
                const bgWidth = textWidth + labelPaddingX * 2;
                const bgHeight = fontSize + labelPaddingY * 2;
                
                // 绘制标签背景
                ctx.fillStyle = 'rgba(30, 41, 59, 0.9)'; // 半透明背景
                ctx.fillRect(
                    finalLabelX - bgWidth / 2,
                    finalLabelY - bgHeight / 2,
                    bgWidth,
                    bgHeight
                );
                
                // 绘制标签文本（只显示上一个id）- 显示在线上方，蓝色字体
                ctx.fillStyle = '#3b82f6'; // 蓝色
                ctx.fillText(fromLabelText, finalLabelX, finalLabelY);
                
                ctx.fillStyle = edgeColor; // 恢复填充色
            }
        }
    });
    
    // 绘制Alt+拖拽时的临时连接线
    if (isAltDragging && dragSourceNode) {
        ctx.strokeStyle = '#3b82f6';
        ctx.fillStyle = '#3b82f6';
        ctx.lineWidth = 2 / zoomScale;
        ctx.setLineDash([5, 5]); // 虚线
        
        const fromX = dragSourceNode.x + 50;
        const fromY = dragSourceNode.y + 25;
        
        if (dragTargetNode) {
            // 绘制到目标节点（带箭头）
            const toX = dragTargetNode.x + 50;
            const toY = dragTargetNode.y + 25;
            
            const dx = toX - fromX;
            const dy = toY - fromY;
            const angle = Math.atan2(dy, dx);
            const distance = Math.sqrt(dx * dx + dy * dy);
            const nodeRadius = 25;
            
            // 计算箭头起点和终点
            const arrowStartDistance = distance - nodeRadius;
            const arrowStartX = fromX + Math.cos(angle) * arrowStartDistance;
            const arrowStartY = fromY + Math.sin(angle) * arrowStartDistance;
            const arrowEndDistance = distance - nodeRadius + 5;
            const arrowEndX = fromX + Math.cos(angle) * arrowEndDistance;
            const arrowEndY = fromY + Math.sin(angle) * arrowEndDistance;
            const lineStartDistance = nodeRadius;
            const lineStartX = fromX + Math.cos(angle) * lineStartDistance;
            const lineStartY = fromY + Math.sin(angle) * lineStartDistance;
            
            // 绘制线条
            ctx.beginPath();
            ctx.moveTo(lineStartX, lineStartY);
            ctx.lineTo(arrowStartX, arrowStartY);
            ctx.stroke();
            
            // 绘制箭头（实心填充）
            const arrowLength = 12 / zoomScale;
            const arrowWidth = 8 / zoomScale;
            ctx.setLineDash([]); // 箭头用实线
            ctx.beginPath();
            ctx.moveTo(arrowEndX, arrowEndY);
            ctx.lineTo(
                arrowEndX - arrowLength * Math.cos(angle - Math.PI / 6),
                arrowEndY - arrowLength * Math.sin(angle - Math.PI / 6)
            );
            ctx.lineTo(
                arrowEndX - arrowWidth * Math.cos(angle - Math.PI / 2),
                arrowEndY - arrowWidth * Math.sin(angle - Math.PI / 2)
            );
            ctx.lineTo(
                arrowEndX - arrowLength * Math.cos(angle + Math.PI / 6),
                arrowEndY - arrowLength * Math.sin(angle + Math.PI / 6)
            );
            ctx.closePath();
            ctx.fill();
        } else {
            // 绘制到鼠标位置（不带箭头）
            const toX = dragMousePos.x;
            const toY = dragMousePos.y;
            
            const dx = toX - fromX;
            const dy = toY - fromY;
            const angle = Math.atan2(dy, dx);
            const nodeRadius = 25;
            
            // 计算线条起点
            const lineStartX = fromX + Math.cos(angle) * nodeRadius;
            const lineStartY = fromY + Math.sin(angle) * nodeRadius;
            
            ctx.beginPath();
            ctx.moveTo(lineStartX, lineStartY);
            ctx.lineTo(toX, toY);
            ctx.stroke();
        }
        ctx.setLineDash([]); // 恢复实线
    }
    
    // 绘制节点
    workflowGraph.nodes.forEach(node => {
        const isSelected = selectedNode === node.id;
        const isHovered = hoveredNode === node.id;
        const stepNumber = nodeSteps.get(node.id) || 0;
        
        // 绘制节点背景
        ctx.fillStyle = isSelected ? '#3b82f6' : '#1e293b';
        ctx.strokeStyle = isSelected ? '#3b82f6' : '#475569';
        ctx.lineWidth = (isSelected ? 3 : 1) / zoomScale; // 线条宽度随缩放调整
        ctx.beginPath();
        // 使用手动绘制圆角矩形
        const x = node.x;
        const y = node.y;
        const w = 100;
        const h = 50;
        const r = 8;
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        // 绘制步骤号（在节点左上角）
        if (stepNumber > 0) {
            ctx.fillStyle = '#3b82f6';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(`步骤${stepNumber}`, node.x + 5, node.y + 5);
        }
        
        // 绘制节点文本
        ctx.fillStyle = '#f0f4ff';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // 显示节点ID（视图或工作流）
        let nodeLabel = node.viewId || '未命名';
        if (node.workflowId && node.nodeType === 'workflow') {
            nodeLabel = node.workflowId;
            // 如果有视图ID，也显示
            if (node.viewId) {
                nodeLabel = `${node.viewId} / ${node.workflowId}`;
            }
        }
        ctx.fillText(nodeLabel, node.x + 50, node.y + 25);
        
        // 显示节点类型标识
        if (node.nodeType === 'workflow') {
            ctx.fillStyle = '#fbbf24';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('工作流', node.x + 95, node.y + 40);
        }
        
        // 只在悬浮或选中时绘制方向按钮
        if (isHovered || isSelected) {
            drawDirectionButtons(ctx, node);
        }
    });
    
    // 恢复状态
    ctx.restore();
}

/**
 * 计算节点的执行步骤（基于x、y坐标）
 * y轴步骤：时间轴的步骤数（上和下按钮）
 * x轴步骤：同一时间的步骤数（左和右按钮）
 */
function calculateNodeSteps() {
    const steps = new Map();
    
    // 按执行y坐标（_y）分组节点，而不是显示y坐标
    const nodesByY = new Map();
    workflowGraph.nodes.forEach(node => {
        const y = node._y !== undefined ? node._y : (node.y !== undefined ? Math.floor((node.y - 150) / 150) : 0);
        if (!nodesByY.has(y)) {
            nodesByY.set(y, []);
        }
        nodesByY.get(y).push(node);
    });
    
    // 按y坐标排序（从小到大）
    const sortedY = Array.from(nodesByY.keys()).sort((a, b) => a - b);
    
    // 对于每个y层级，步骤数 = y层级索引 + 1
    sortedY.forEach((y, yIndex) => {
        const nodesAtY = nodesByY.get(y);
        nodesAtY.forEach(node => {
            // 步骤数基于y坐标（时间轴）
            steps.set(node.id, yIndex + 1);
        });
    });
    
    return steps;
}

/**
 * 绘制方向按钮
 */
function drawDirectionButtons(ctx, node) {
    const buttonSize = 20;
    const directions = [
        { dir: 'up', x: node.x + 50, y: node.y - 10, icon: '↑' },
        { dir: 'down', x: node.x + 50, y: node.y + 60, icon: '↓' },
        { dir: 'left', x: node.x - 10, y: node.y + 25, icon: '←' },
        { dir: 'right', x: node.x + 110, y: node.y + 25, icon: '→' }
    ];
    
    directions.forEach(dir => {
        ctx.fillStyle = '#334155';
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(dir.x, dir.y, buttonSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        ctx.fillStyle = '#f0f4ff';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(dir.icon, dir.x, dir.y);
    });
}

/**
 * 处理鼠标按下
 */
function handleMouseDown(e) {
    const canvas = document.getElementById('workflow-canvas');
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    
    // 转换为画布坐标
    const canvasPos = screenToCanvas(screenX, screenY);
    const x = canvasPos.x;
    const y = canvasPos.y;
    
    mouseDownPos = { x: screenX, y: screenY };
    hasMoved = false;
    
    // 检查是否按住Alt键（用于连接节点）
    if (e.altKey) {
        // Alt+点击节点：开始连接模式
        for (const node of workflowGraph.nodes) {
            if (x >= node.x && x <= node.x + 100 && y >= node.y && y <= node.y + 50) {
                isAltDragging = true;
                dragSourceNode = node;
                dragTargetNode = null;
                dragMousePos = { x, y };
                canvas.style.cursor = 'crosshair';
                renderWorkflowGraph();
                return;
            }
        }
    }
    
    // 检查是否点击了节点
    for (const node of workflowGraph.nodes) {
        // 检查是否点击了方向按钮（优先处理）
        const directions = [
            { dir: 'up', x: node.x + 50, y: node.y - 10 },
            { dir: 'down', x: node.x + 50, y: node.y + 60 },
            { dir: 'left', x: node.x - 10, y: node.y + 25 },
            { dir: 'right', x: node.x + 110, y: node.y + 25 }
        ];
        
        for (const dir of directions) {
            const dist = Math.sqrt(Math.pow(x - dir.x, 2) + Math.pow(y - dir.y, 2));
            if (dist <= 10 / zoomScale) { // 考虑缩放
                handleAddNode(node, dir.dir);
                return;
            }
        }
        
        // 检查是否点击了节点本身（Alt键时跳过，因为Alt键用于连接）
        if (!e.altKey && x >= node.x && x <= node.x + 100 && y >= node.y && y <= node.y + 50) {
            selectedNode = node.id;
            isDragging = true;
            dragOffset.x = x - node.x;
            dragOffset.y = y - node.y;
            canvas.focus(); // 使canvas获得焦点以接收键盘事件
            renderWorkflowGraph();
            return;
        }
    }
    
    // 如果没有点击任何节点，开始平移画布（Alt键时跳过，因为Alt键用于连接）
    if (!e.altKey) {
        selectedNode = null;
        isPanning = true;
        panStartOffset = { x: panOffset.x, y: panOffset.y };
        dragOffset = { x: screenX, y: screenY };
        canvas.style.cursor = 'grabbing'; // 改变鼠标样式
        renderWorkflowGraph();
    }
}

/**
 * 处理鼠标移动
 */
function handleMouseMove(e) {
    const canvas = document.getElementById('workflow-canvas');
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    
    // 转换为画布坐标
    const canvasPos = screenToCanvas(screenX, screenY);
    const x = canvasPos.x;
    const y = canvasPos.y;
    
    // 检查鼠标是否悬浮在节点上
    let newHoveredNode = null;
    for (const node of workflowGraph.nodes) {
        if (x >= node.x && x <= node.x + 100 && y >= node.y && y <= node.y + 50) {
            newHoveredNode = node.id;
            break;
        }
    }
    
    // 如果悬浮的节点改变了，重新渲染
    if (newHoveredNode !== hoveredNode) {
        hoveredNode = newHoveredNode;
        renderWorkflowGraph();
    }
    
    // 更新鼠标样式：在空白区域显示为可拖动
    if (!isPanning && !isDragging) {
        const canvas = document.getElementById('workflow-canvas');
        if (canvas) {
            if (newHoveredNode === null) {
                canvas.style.cursor = 'grab'; // 空白区域显示为可拖动
            } else {
                canvas.style.cursor = 'pointer'; // 节点上显示为指针
            }
        }
    }
    
    // 处理Alt+拖拽连接节点（优先处理，确保原节点不动）
    if (isAltDragging && dragSourceNode) {
        // 注意：这里只更新鼠标位置和目标节点检测，不更新dragSourceNode的位置
        // dragSourceNode的x和y保持不变，确保原节点不动
        dragMousePos = { x, y }; // 更新鼠标位置（用于绘制临时连接线）
        // 检查是否悬浮在目标节点上
        let newTargetNode = null;
        for (const node of workflowGraph.nodes) {
            if (node.id !== dragSourceNode.id && 
                x >= node.x && x <= node.x + 100 && y >= node.y && y <= node.y + 50) {
                newTargetNode = node;
                break;
            }
        }
        
        if (newTargetNode !== dragTargetNode) {
            dragTargetNode = newTargetNode;
            renderWorkflowGraph();
        } else {
            // 即使目标节点没变，也要重新渲染以更新临时连接线
            renderWorkflowGraph();
        }
        // 重要：return确保不会执行后面的节点拖拽逻辑，原节点位置不变
        return;
    }
    
    // 处理画布平移
    if (isPanning) {
        // 计算平移距离
        const deltaX = screenX - dragOffset.x;
        const deltaY = screenY - dragOffset.y;
        
        // 更新平移偏移
        panOffset.x = panStartOffset.x + deltaX;
        panOffset.y = panStartOffset.y + deltaY;
        
        renderWorkflowGraph();
        return; // 平移时不再处理节点拖动
    }
    
    if (isDragging && selectedNode) {
        // 检查是否移动了（用于区分拖拽和单击）
        const moveDist = Math.sqrt(
            Math.pow(screenX - mouseDownPos.x, 2) + Math.pow(screenY - mouseDownPos.y, 2)
        );
        if (moveDist > 5) {
            hasMoved = true;
        }
        
        const node = workflowGraph.nodes.find(n => n.id === selectedNode);
        if (node) {
            node.x = x - dragOffset.x;
            node.y = y - dragOffset.y;
            renderWorkflowGraph();
        }
    }
}

/**
 * 处理鼠标离开画布
 */
function handleMouseLeave(e) {
    hoveredNode = null;
    // 如果正在平移，停止平移
    if (isPanning) {
        isPanning = false;
        const canvas = document.getElementById('workflow-canvas');
        if (canvas) {
            canvas.style.cursor = ''; // 恢复鼠标样式
        }
    }
    renderWorkflowGraph();
}

/**
 * 处理鼠标滚轮缩放
 */
function handleWheel(e) {
    // 只在按住 Alt 键时进行缩放
    if (!e.altKey) return;
    
    e.preventDefault();
    
    const canvas = document.getElementById('workflow-canvas');
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // 计算鼠标在画布坐标系中的位置（缩放前）
    const canvasX = (mouseX - panOffset.x) / zoomScale;
    const canvasY = (mouseY - panOffset.y) / zoomScale;
    
    // 计算缩放增量
    const zoomIntensity = 0.1;
    const zoomFactor = e.deltaY > 0 ? (1 - zoomIntensity) : (1 + zoomIntensity);
    const newScale = Math.max(0.1, Math.min(5, zoomScale * zoomFactor));
    
    // 计算新的偏移，使鼠标位置在缩放后保持不变
    panOffset.x = mouseX - canvasX * newScale;
    panOffset.y = mouseY - canvasY * newScale;
    
    zoomScale = newScale;
    
    renderWorkflowGraph();
}

/**
 * 处理鼠标释放
 */
function handleMouseUp(e) {
    // 处理Alt+拖拽连接节点
    if (isAltDragging && dragSourceNode && dragTargetNode) {
        // 创建连接（添加到目标节点的viewPrev中）
        const sourceViewId = dragSourceNode.viewId;
        const targetViewId = dragTargetNode.viewId;
        
        // 检查连接是否已存在
        const existingEdge = workflowGraph.edges.find(edge => 
            edge.from === dragSourceNode.id && edge.to === dragTargetNode.id
        );
        
        if (!existingEdge) {
            // 添加边
            workflowGraph.edges.push({
                from: dragSourceNode.id,
                to: dragTargetNode.id,
                edgeType: 'view'
            });
            updateWorkflowContent();
        }
        
        // 重置状态（延迟重置isAltDragging，以屏蔽单击事件）
        dragSourceNode = null;
        dragTargetNode = null;
        const canvas = document.getElementById('workflow-canvas');
        if (canvas) {
            canvas.style.cursor = '';
        }
        renderWorkflowGraph();
        // 延迟重置isAltDragging，确保handleCanvasClick能检测到并屏蔽
        setTimeout(() => {
            isAltDragging = false;
        }, 100);
        return;
    }
    
    // 如果Alt键松开但没连接到节点，取消连接模式
    if (isAltDragging) {
        dragSourceNode = null;
        dragTargetNode = null;
        const canvas = document.getElementById('workflow-canvas');
        if (canvas) {
            canvas.style.cursor = '';
        }
        renderWorkflowGraph();
        // 延迟重置isAltDragging，确保handleCanvasClick能检测到并屏蔽
        setTimeout(() => {
            isAltDragging = false;
        }, 100);
        return;
    }
    
    isDragging = false;
    if (isPanning) {
        isPanning = false;
        const canvas = document.getElementById('workflow-canvas');
        if (canvas) {
            canvas.style.cursor = ''; // 恢复鼠标样式
        }
    }
}

/**
 * 处理画布点击
 */
function handleCanvasClick(e) {
    // 如果正在添加节点，不处理点击事件（防止重复弹出选择器）
    if (isAddingNode) {
        isAddingNode = false;
        hasMoved = false;
        return;
    }
    
    // 如果刚刚完成Alt+拖拽，屏蔽单击打开选择器功能
    if (isAltDragging) {
        hasMoved = false;
        return;
    }
    
    // 单击节点时快速编辑（只有在没有拖拽的情况下）
    if (selectedNode && !hasMoved) {
        const node = workflowGraph.nodes.find(n => n.id === selectedNode);
        if (node) {
            // 检查是否已经有选择器打开
            const existingSelector = document.getElementById('view-id-selector');
            if (!existingSelector) {
                showViewIdSelector(node);
            }
        }
    }
    hasMoved = false;
}

/**
 * 处理键盘事件
 */
function handleKeyDown(e) {
    // 检查工作流面板是否打开
    const workflowPanel = document.getElementById('workflow-panel');
    if (!workflowPanel || workflowPanel.style.display !== 'flex') {
        return; // 如果工作流面板未打开，不处理键盘事件
    }
    
    // Delete键删除选中的节点
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNode) {
        e.preventDefault();
        e.stopPropagation();
        deleteSelectedNode();
    }
}

/**
 * 删除选中的节点
 */
function deleteSelectedNode() {
    if (!selectedNode) return;
    
    const node = workflowGraph.nodes.find(n => n.id === selectedNode);
    if (!node) return;
    
    // 删除所有相关的边
    workflowGraph.edges = workflowGraph.edges.filter(
        edge => edge.from !== selectedNode && edge.to !== selectedNode
    );
    
    // 删除节点
    workflowGraph.nodes = workflowGraph.nodes.filter(n => n.id !== selectedNode);
    
    selectedNode = null;
    renderWorkflowGraph();
    updateWorkflowContent();
}

/**
 * 显示视图ID选择器
 */
function showViewIdSelector(node) {
    // 如果已经有选择器打开，先关闭它
    const existingSelector = document.getElementById('view-id-selector');
    if (existingSelector) {
        document.body.removeChild(existingSelector);
    }
    
    // 创建选择器面板
    const selector = document.createElement('div');
    selector.id = 'view-id-selector';
    selector.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: var(--bg-pane);
        border: 2px solid var(--border);
        border-radius: var(--border-radius-lg);
        padding: 20px;
        z-index: 100000 !important;
        min-width: 300px;
        max-width: 500px;
        max-height: 70vh;
        overflow-y: auto;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    `;
    
    selector.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <h3 style="color: var(--accent-blue); margin: 0;">选择节点</h3>
            <button id="close-view-selector" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 20px;">✕</button>
        </div>
        <div style="margin-bottom: 15px; display: flex; gap: 10px;">
            <button id="select-view-type" class="btn" style="flex: 1; padding: 8px;">视图节点</button>
            <button id="select-workflow-type" class="btn" style="flex: 1; padding: 8px;">工作流节点</button>
        </div>
        <div style="margin-bottom: 15px;">
            <input type="text" id="node-id-input" placeholder="或直接输入ID" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: var(--border-radius); background: var(--bg-tertiary); color: var(--text-primary);">
        </div>
        <div id="node-id-list" style="display: flex; flex-direction: column; gap: 5px;">
        </div>
    `;
    
    let currentNodeType = 'view'; // 'view' 或 'workflow'
    
    // 节点类型切换按钮（在appendChild之后获取，使用selector.querySelector）
    const viewTypeBtn = selector.querySelector('#select-view-type');
    const workflowTypeBtn = selector.querySelector('#select-workflow-type');
    const updateSelectorContent = () => {
        const input = selector.querySelector('#node-id-input');
        const list = selector.querySelector('#node-id-list');
        
        if (currentNodeType === 'view') {
            input.placeholder = '或直接输入视图ID';
            list.innerHTML = '';
            if (state.views && state.views.length > 0) {
                state.views.forEach(view => {
                    const item = document.createElement('div');
                    item.style.cssText = `
                        padding: 10px;
                        background: var(--bg-secondary);
                        border: 1px solid var(--border);
                        border-radius: var(--border-radius);
                        cursor: pointer;
                        transition: all 0.2s;
                    `;
                    item.textContent = view.id;
                    item.addEventListener('mouseenter', () => {
                        item.style.background = 'var(--bg-tertiary)';
                        item.style.borderColor = 'var(--accent-blue)';
                    });
                    item.addEventListener('mouseleave', () => {
                        item.style.background = 'var(--bg-secondary)';
                        item.style.borderColor = 'var(--border)';
                    });
                    item.addEventListener('click', () => {
                        node.viewId = view.id;
                        node.nodeType = 'view';
                        if (!node.workflowId) {
                            node.workflowId = null;
                        }
                        selectedNode = null;
                        renderWorkflowGraph();
                        updateWorkflowContent();
                        if (document.body.contains(selector)) {
                            document.body.removeChild(selector);
                        }
                    });
                    list.appendChild(item);
                });
            } else {
                list.innerHTML = '<div style="color: var(--text-muted); padding: 10px; text-align: center;">没有可用的视图</div>';
            }
            viewTypeBtn.style.background = 'var(--accent-blue)';
            workflowTypeBtn.style.background = 'var(--bg-tertiary)';
        } else {
            input.placeholder = '或直接输入工作流ID';
            list.innerHTML = '';
            if (state.workflows && state.workflows.length > 0) {
                state.workflows.forEach(workflow => {
                    const item = document.createElement('div');
                    item.style.cssText = `
                        padding: 10px;
                        background: var(--bg-secondary);
                        border: 1px solid var(--border);
                        border-radius: var(--border-radius);
                        cursor: pointer;
                        transition: all 0.2s;
                    `;
                    item.innerHTML = `
                        <div style="font-weight: bold;">${workflow.name}</div>
                        ${workflow.description ? `<div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">${workflow.description}</div>` : ''}
                    `;
                    item.addEventListener('mouseenter', () => {
                        item.style.background = 'var(--bg-tertiary)';
                        item.style.borderColor = 'var(--accent-blue)';
                    });
                    item.addEventListener('mouseleave', () => {
                        item.style.background = 'var(--bg-secondary)';
                        item.style.borderColor = 'var(--border)';
                    });
                    item.addEventListener('click', () => {
                        node.workflowId = workflow.name;
                        node.nodeType = 'workflow';
                        if (!node.viewId) {
                            node.viewId = workflow.name; // 如果没有视图ID，使用工作流名称作为默认值
                        }
                        selectedNode = null;
                        renderWorkflowGraph();
                        updateWorkflowContent();
                        if (document.body.contains(selector)) {
                            document.body.removeChild(selector);
                        }
                    });
                    list.appendChild(item);
                });
            } else {
                list.innerHTML = '<div style="color: var(--text-muted); padding: 10px; text-align: center;">没有可用的工作流</div>';
            }
            viewTypeBtn.style.background = 'var(--bg-tertiary)';
            workflowTypeBtn.style.background = 'var(--accent-blue)';
        }
    };
    
    viewTypeBtn.addEventListener('click', () => {
        currentNodeType = 'view';
        updateSelectorContent();
    });
    
    workflowTypeBtn.addEventListener('click', () => {
        currentNodeType = 'workflow';
        updateSelectorContent();
    });
    
    // 先添加到DOM，然后再获取元素和绑定事件
    document.body.appendChild(selector);
    
    // 关闭选择器的函数
    const closeSelector = () => {
        if (document.body.contains(selector)) {
            document.body.removeChild(selector);
        }
    };
    
    // 初始化显示视图列表（在appendChild之后）
    updateSelectorContent();
    
    // 关闭按钮（在appendChild之后获取）
    const closeBtn = selector.querySelector('#close-view-selector');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeSelector);
    }
    
    // 输入框回车确认（在appendChild之后获取）
    const input = selector.querySelector('#node-id-input');
    if (input) {
        input.focus();
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const value = input.value.trim();
                if (value) {
                    if (currentNodeType === 'view') {
                        node.viewId = value;
                        node.nodeType = 'view';
                    } else {
                        node.workflowId = value;
                        node.nodeType = 'workflow';
                        if (!node.viewId) {
                            node.viewId = value; // 如果没有视图ID，使用工作流名称作为默认值
                        }
                    }
                    selectedNode = null;
                    renderWorkflowGraph();
                    updateWorkflowContent();
                    closeSelector();
                }
            } else if (e.key === 'Escape') {
                closeSelector();
            }
        });
    }
    
    // 点击外部关闭
    selector.addEventListener('click', (e) => {
        if (e.target === selector) {
            closeSelector();
        }
    });
}

/**
 * 添加节点
 */
function handleAddNode(fromNode, direction) {
    // 设置标志，防止点击事件触发选择器
    isAddingNode = true;
    
    // 计算新节点位置和坐标
    let x = fromNode.x;
    let y = fromNode.y;
    const offset = 150;
    
    // 计算新节点的x、y坐标值（用于工作流格式）
    let newX = fromNode.x !== undefined ? Math.floor((fromNode.x - 200) / 200) : 0;
    let newY = fromNode.y !== undefined ? Math.floor((fromNode.y - 150) / 150) : 0;
    
    switch (direction) {
        case 'up':
            y -= offset;
            newY = Math.max(0, newY - 1); // y轴减少（时间轴的上一步）
            break;
        case 'down':
            y += offset;
            newY += 1; // y轴增加（时间轴的下一步）
            break;
        case 'left':
            x -= offset;
            newX = Math.max(0, newX - 1); // x轴减少（同一时间的上一个事件）
            break;
        case 'right':
            x += offset;
            newX += 1; // x轴增加（同一时间的下一个事件）
            break;
    }
    
    // 创建新节点（使用默认视图ID，用户稍后可以编辑）
    const newNodeId = `node_${workflowGraph.nodes.length}`;
    const newNode = {
        id: newNodeId,
        x: x,
        y: y,
        viewId: '新节点',
        workflowId: null,
        nodeType: 'view',
        // 保存坐标值以便在updateWorkflowContent中使用
        _x: newX,
        _y: newY
    };
    workflowGraph.nodes.push(newNode);
    
    // 创建边（默认创建视图边）
    workflowGraph.edges.push({
        from: fromNode.id,
        to: newNodeId,
        edgeType: 'view'
    });
    
    // 选中新节点并显示选择器
    selectedNode = newNodeId;
    renderWorkflowGraph();
    updateWorkflowContent();
    
    // 延迟显示选择器，确保点击事件处理完成
    setTimeout(() => {
        showViewIdSelector(newNode);
        isAddingNode = false;
    }, 10);
}

/**
 * 更新工作流内容
 */
function updateWorkflowContent() {
    // 将图形转换为工作流格式
    const steps = [];
    
    workflowGraph.nodes.forEach(node => {
        // 计算x、y坐标（优先使用保存的坐标值，否则使用节点位置估算）
        const x = node._x !== undefined ? node._x : (node.x !== undefined ? Math.floor((node.x - 200) / 200) : 0);
        const y = node._y !== undefined ? node._y : (node.y !== undefined ? Math.floor((node.y - 150) / 150) : 0);
        
        // 关键修复：如果节点是工作流节点，清除视图ID，避免视图节点和工作流节点在同一个步骤
        const isWorkflowNode = node.nodeType === 'workflow' || (node.workflowId && node.workflowId.trim() !== '');
        
        // 关键修复：重新设计viewPrev和viewNext的构建逻辑
        // 对于视图节点：viewPrev和viewNext应该包含所有连接到它的节点（包括视图节点和工作流节点）
        // 对于工作流节点：workflowPrev和workflowNext应该包含所有连接到它的节点（包括视图节点和工作流节点）
        const viewPrevIds = [];
        const viewNextIds = [];
        
        if (!isWorkflowNode) {
            // 视图节点：从所有指向它的边获取前置节点
            const incomingEdges = workflowGraph.edges.filter(e => e.to === node.id);
            incomingEdges.forEach(e => {
                const fromNode = workflowGraph.nodes.find(n => n.id === e.from);
                if (fromNode) {
                    // 如果源节点是视图节点，使用viewId
                    if (!fromNode.workflowId || fromNode.workflowId.trim() === '') {
                        if (fromNode.viewId && fromNode.viewId !== '无') {
                            viewPrevIds.push(fromNode.viewId);
                        }
                    } else {
                        // 如果源节点是工作流节点，使用workflowId（作为viewPrev，因为工作流节点可以传递给视图节点）
                        if (fromNode.workflowId && fromNode.workflowId !== '无') {
                            viewPrevIds.push(fromNode.workflowId);
                        }
                    }
                }
            });
            
            // 视图节点：从所有它指向的边获取后置节点
            const outgoingEdges = workflowGraph.edges.filter(e => e.from === node.id);
            outgoingEdges.forEach(e => {
                const toNode = workflowGraph.nodes.find(n => n.id === e.to);
                if (toNode) {
                    // 如果目标节点是视图节点，使用viewId
                    if (!toNode.workflowId || toNode.workflowId.trim() === '') {
                        if (toNode.viewId && toNode.viewId !== '无') {
                            viewNextIds.push(toNode.viewId);
                        }
                    } else {
                        // 如果目标节点是工作流节点，使用workflowId（作为viewNext，因为视图节点可以传递给工作流节点）
                        if (toNode.workflowId && toNode.workflowId !== '无') {
                            viewNextIds.push(toNode.workflowId);
                        }
                    }
                }
            });
        }
        
        // 工作流节点：workflowPrev和workflowNext应该包含所有连接到它的节点
        const workflowPrevIds = [];
        const workflowNextIds = [];
        
        if (isWorkflowNode) {
            // 工作流节点：从所有指向它的边获取前置节点
            const incomingEdges = workflowGraph.edges.filter(e => e.to === node.id);
            incomingEdges.forEach(e => {
                const fromNode = workflowGraph.nodes.find(n => n.id === e.from);
                if (fromNode) {
                    // 如果源节点是视图节点，使用viewId（作为workflowPrev，因为视图节点可以传递给工作流节点）
                    if (!fromNode.workflowId || fromNode.workflowId.trim() === '') {
                        if (fromNode.viewId && fromNode.viewId !== '无') {
                            workflowPrevIds.push(fromNode.viewId);
                        }
                    } else {
                        // 如果源节点是工作流节点，使用workflowId
                        if (fromNode.workflowId && fromNode.workflowId !== '无') {
                            workflowPrevIds.push(fromNode.workflowId);
                        }
                    }
                }
            });
            
            // 工作流节点：从所有它指向的边获取后置节点
            const outgoingEdges = workflowGraph.edges.filter(e => e.from === node.id);
            outgoingEdges.forEach(e => {
                const toNode = workflowGraph.nodes.find(n => n.id === e.to);
                if (toNode) {
                    // 如果目标节点是视图节点，使用viewId（作为workflowNext，因为工作流节点可以传递给视图节点）
                    if (!toNode.workflowId || toNode.workflowId.trim() === '') {
                        if (toNode.viewId && toNode.viewId !== '无') {
                            workflowNextIds.push(toNode.viewId);
                        }
                    } else {
                        // 如果目标节点是工作流节点，使用workflowId
                        if (toNode.workflowId && toNode.workflowId !== '无') {
                            workflowNextIds.push(toNode.workflowId);
                        }
                    }
                }
            });
        }
        
        // 关键修复：如果节点是工作流节点，清除视图ID，避免视图节点和工作流节点在同一个步骤
        const effectiveViewId = isWorkflowNode ? null : (node.viewId || '测试');
        
        steps.push({
            x: x,
            y: y,
            viewId: effectiveViewId,
            workflowId: node.workflowId || null,
            viewPrev: viewPrevIds,
            viewNext: viewNextIds,
            workflowPrev: workflowPrevIds,
            workflowNext: workflowNextIds
        });
    });
    
    const workflowContent = generateWorkflowFormat(steps);
    
    // 更新工作流内容输入框
    const contentInput = document.getElementById('workflow-content');
    if (contentInput) {
        contentInput.value = workflowContent;
    }
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.initWorkflowVisualizer = initWorkflowVisualizer;
    window.renderWorkflowFromContent = renderWorkflowFromContent;
    window.updateWorkflowContent = updateWorkflowContent;
}

