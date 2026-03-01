/**
 * 右键菜单模块
 * 负责主界面的右键菜单显示和交互
 */

import { state } from '../core/state.js';
import { loadPrompts } from './promptManager.js';
import { selectPrompt } from './promptManager.js';
import { loadLayouts } from './layoutManager.js';
import { selectLayout } from './layoutManager.js';
import { loadEvents } from './eventManager.js';
import { executeEvent } from './eventManager.js';
import { loadWorkflows } from './workflowManager.js';
import { createFile, createFolder } from '../core/api.js';
import { organizeFiles } from './fileOrganizer.js';
import { getFileFolderPath } from '../utils/fileUtils.js';
import { pathUtils } from '../utils/path.js';

/**
 * 初始化右键菜单
 */
export function initContextMenu() {
    const viewerGrid = document.getElementById('viewer-grid');
    if (!viewerGrid) return;
    
    // 创建右键菜单容器
    const contextMenu = document.createElement('div');
    contextMenu.id = 'context-menu';
    contextMenu.style.cssText = `
        position: fixed;
        display: none;
        background: var(--bg-pane);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        box-shadow: var(--shadow-hover);
        z-index: 20000; /* 提高层级，确保始终在各类面板和悬浮元素之上 */
        min-width: 200px;
        padding: 4px;
    `;
    document.body.appendChild(contextMenu);
    
    // 创建子菜单容器
    const subMenu = document.createElement('div');
    subMenu.id = 'context-submenu';
    subMenu.style.cssText = `
        position: fixed;
        display: none;
        background: var(--bg-pane);
        border: 1px solid var(--border);
        border-radius: var(--border-radius);
        box-shadow: var(--shadow-hover);
        z-index: 20001; /* 比主菜单略高，避免被主菜单遮挡 */
        min-width: 200px;
        max-width: 400px;
        max-height: 500px;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 4px;
        margin-left: 4px;
    `;
    // 确保滚动条可见（WebKit浏览器）
    subMenu.style.scrollbarWidth = 'thin';
    subMenu.style.scrollbarColor = 'var(--border) var(--bg-pane)';
    // 添加滚动条样式（通过CSS类）
    const style = document.createElement('style');
    style.textContent = `
        #context-submenu::-webkit-scrollbar {
            width: 8px;
        }
        #context-submenu::-webkit-scrollbar-track {
            background: var(--bg-pane);
            border-radius: 4px;
        }
        #context-submenu::-webkit-scrollbar-thumb {
            background: var(--border);
            border-radius: 4px;
        }
        #context-submenu::-webkit-scrollbar-thumb:hover {
            background: var(--accent-blue);
        }
    `;
    document.head.appendChild(style);
    document.body.appendChild(subMenu);
    
    let currentSubMenuType = null;
    let subMenuTimeout = null;
    
    /**
     * 显示右键菜单
     */
    function showContextMenu(x, y) {
        contextMenu.style.display = 'block';
        contextMenu.style.left = x + 'px';
        contextMenu.style.top = y + 'px';
        
        // 确保菜单不超出视窗
        const rect = contextMenu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            contextMenu.style.left = (window.innerWidth - rect.width - 10) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            contextMenu.style.top = (window.innerHeight - rect.height - 10) + 'px';
        }
        
        renderMainMenu();
    }
    
    /**
     * 隐藏右键菜单
     */
    function hideContextMenu() {
        contextMenu.style.display = 'none';
        subMenu.style.display = 'none';
        currentSubMenuType = null;
        if (subMenuTimeout) {
            clearTimeout(subMenuTimeout);
            subMenuTimeout = null;
        }
    }
    
    /**
     * 渲染主菜单
     */
    function renderMainMenu() {
        contextMenu.innerHTML = `
            <div class="context-menu-item" data-type="new">
                <span>➕ 新建</span>
                <span style="margin-left: auto; color: var(--text-muted);">▶</span>
            </div>
            <div class="context-menu-item" data-type="organize">
                <span>📦 整理文件</span>
            </div>
            <div class="context-menu-item" data-type="prompt">
                <span>📝 提示词</span>
                <span style="margin-left: auto; color: var(--text-muted);">▶</span>
            </div>
            <div class="context-menu-item" data-type="layout">
                <span>📐 视窗布局</span>
                <span style="margin-left: auto; color: var(--text-muted);">▶</span>
            </div>
            <div class="context-menu-item" data-type="event">
                <span>📅 事件</span>
                <span style="margin-left: auto; color: var(--text-muted);">▶</span>
            </div>
            <div class="context-menu-item" data-type="workflow">
                <span>🔄 工作流</span>
                <span style="margin-left: auto; color: var(--text-muted);">▶</span>
            </div>
        `;
        
        // 添加菜单项样式
        const style = document.createElement('style');
        style.id = 'context-menu-style';
        if (!document.getElementById('context-menu-style')) {
            style.textContent = `
                .context-menu-item {
                    padding: 10px 14px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    color: var(--text-primary);
                    transition: background-color 0.2s;
                    border-radius: var(--border-radius);
                }
                .context-menu-item:hover {
                    background: var(--accent-bg);
                    color: var(--accent-blue);
                }
                .context-submenu-item {
                    padding: 10px 14px;
                    cursor: pointer;
                    color: var(--text-primary);
                    transition: background-color 0.2s;
                    border-radius: var(--border-radius);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .context-submenu-item:hover {
                    background: var(--accent-bg);
                    color: var(--accent-blue);
                }
            `;
            document.head.appendChild(style);
        }
        
        // 绑定菜单项事件
        contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
            const type = item.dataset.type;
            
            if (type === 'organize') {
                // 整理文件菜单项直接点击执行
                item.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    hideContextMenu();
                    await handleOrganizeFiles();
                });
                return;
            }
            
            // 一级菜单项点击：打开对应的管理面板
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                hideContextMenu();
                openManagementPanel(type);
            });
            
            // 其他菜单项有子菜单
            // 鼠标进入，显示子菜单
            item.addEventListener('mouseenter', () => {
                if (subMenuTimeout) {
                    clearTimeout(subMenuTimeout);
                }
                showSubMenu(type, item);
            });
            
            // 鼠标离开，延迟隐藏子菜单
            item.addEventListener('mouseleave', () => {
                subMenuTimeout = setTimeout(() => {
                    if (!subMenu.matches(':hover') && !item.matches(':hover')) {
                        subMenu.style.display = 'none';
                        currentSubMenuType = null;
                    }
                }, 200);
            });
        });
    }
    
    /**
     * 显示子菜单
     */
    async function showSubMenu(type, menuItem) {
        currentSubMenuType = type;
        
        // 加载并渲染子菜单内容（先加载内容才能获取实际尺寸）
        subMenu.innerHTML = '<div style="padding: 10px; color: var(--text-muted);">加载中...</div>';
        subMenu.style.display = 'block';
        
        try {
            if (type === 'new') {
                renderNewSubMenu();
            } else if (type === 'prompt') {
                await loadPrompts();
                renderPromptSubMenu();
            } else if (type === 'layout') {
                await loadLayouts();
                renderLayoutSubMenu();
            } else if (type === 'event') {
                await loadEvents();
                renderEventSubMenu();
            } else if (type === 'workflow') {
                await loadWorkflows();
                renderWorkflowSubMenu();
            }
        } catch (error) {
            console.error('加载子菜单失败:', error);
            subMenu.innerHTML = `<div style="padding: 10px; color: var(--accent-purple);">加载失败: ${error.message}</div>`;
        }
        
        // 等待DOM更新后计算位置
        await new Promise(resolve => setTimeout(resolve, 0));
        
        // 计算子菜单位置
        const menuRect = contextMenu.getBoundingClientRect();
        const itemRect = menuItem.getBoundingClientRect();
        const margin = 10; // 边距
        
        // 初始位置：默认显示在主菜单右侧
        let subMenuX = menuRect.right + 4;
        let subMenuY = itemRect.top;
        
        // 获取子菜单实际尺寸
        const subMenuRect = subMenu.getBoundingClientRect();
        const subMenuWidth = subMenuRect.width;
        const subMenuHeight = subMenuRect.height;
        
        // 检查右边界：如果超出，显示在左侧
        if (subMenuX + subMenuWidth > window.innerWidth - margin) {
            subMenuX = menuRect.left - subMenuWidth - 4;
            // 如果左侧也超出，则靠右显示
            if (subMenuX < margin) {
                subMenuX = window.innerWidth - subMenuWidth - margin;
            }
        }
        
        // 检查左边界：如果超出，显示在右侧
        if (subMenuX < margin) {
            subMenuX = menuRect.right + 4;
            // 如果右侧也超出，则靠左显示
            if (subMenuX + subMenuWidth > window.innerWidth - margin) {
                subMenuX = margin;
            }
        }
        
        // 检查下边界：如果超出，向上调整
        if (subMenuY + subMenuHeight > window.innerHeight - margin) {
            // 计算向上调整的位置，确保菜单顶部对齐到合适位置
            subMenuY = window.innerHeight - subMenuHeight - margin;
            // 如果向上调整后顶部超出，则从顶部开始显示
            if (subMenuY < margin) {
                subMenuY = margin;
            }
        }
        
        // 检查上边界：如果超出，向下调整
        if (subMenuY < margin) {
            // 如果顶部空间不足，从顶部开始显示
            subMenuY = margin;
        }
        
        // 应用位置
        subMenu.style.left = subMenuX + 'px';
        subMenu.style.top = subMenuY + 'px';
    }
    
    /**
     * 渲染新建子菜单
     */
    function renderNewSubMenu() {
        if (currentSubMenuType !== 'new') return;
        
        subMenu.innerHTML = `
            <div class="context-submenu-item" data-action="new-file">
                📄 新建文件
            </div>
            <div class="context-submenu-item" data-action="new-folder">
                📁 新建文件夹
            </div>
        `;
        
        // 绑定点击事件
        subMenu.querySelectorAll('.context-submenu-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                hideContextMenu();
                
                if (action === 'new-file') {
                    await handleNewFile();
                } else if (action === 'new-folder') {
                    await handleNewFolder();
                }
            });
        });
    }
    
    /**
     * 处理新建文件
     */
    async function handleNewFile() {
        const currentDir = document.getElementById('dir-path')?.value || state.currentDir;
        // 右键新建文件：同样进入“先写内容，后命名”的模式
        try {
            state.isCreatingNewFile = true;
            state.newFileDir = currentDir;
            state.originalPath = null;
            state.originalPanePaths = {};
            if (!state.panePaths) state.panePaths = {};
            if (!state.rawContents) state.rawContents = {};

            const mainView = state.views && state.views[0];
            if (mainView) {
                state.panePaths[mainView.id] = null;
                state.rawContents[mainView.id] = '';

                const viewEl = document.getElementById(`view-${mainView.id}`);
                if (viewEl) {
                    viewEl.innerHTML = '';
                }

                const { enterEditMode } = await import('./paragraphEditor.js');
                await enterEditMode(mainView.id, null);
            }
        } catch (error) {
            alert('进入新建文件编辑模式失败: ' + error.message);
        }
    }
    
    /**
     * 处理新建文件夹
     */
    async function handleNewFolder() {
        const currentDir = document.getElementById('dir-path')?.value || state.currentDir;
        const folderName = prompt('请输入文件夹名:');
        if (folderName) {
            const folderPath = pathUtils.join(currentDir, folderName).replace(/\\/g, '/');
            try {
                await createFolder(folderPath);
                alert('文件夹创建成功');
                if (window.loadDir) {
                    await window.loadDir(currentDir);
                }
            } catch (error) {
                alert('创建失败: ' + error.message);
            }
        }
    }
    
    /**
     * 处理整理文件
     */
    async function handleOrganizeFiles() {
        const currentDir = document.getElementById('dir-path')?.value || state.currentDir;
        
        if (!confirm('确定要整理当前目录的文件吗？\n\n这将把视图文件和AI文件移动到对应的文件名文件夹中，主文件保持在根目录。')) {
            return;
        }
        
        try {
            const result = await organizeFiles(currentDir);
            
            let message = `整理完成！\n\n成功整理: ${result.organizedCount} 个文件`;
            if (result.errorCount > 0) {
                message += `\n失败: ${result.errorCount} 个文件`;
            }
            alert(message);
        } catch (error) {
            alert('整理失败: ' + error.message);
        }
    }
    
    /**
     * 渲染提示词子菜单
     */
    function renderPromptSubMenu() {
        if (currentSubMenuType !== 'prompt') return;
        
        if (!state.prompts || state.prompts.length === 0) {
            subMenu.innerHTML = '<div style="padding: 10px; color: var(--text-muted);">暂无提示词</div>';
            return;
        }
        
        subMenu.innerHTML = state.prompts.map(prompt => `
            <div class="context-submenu-item" data-prompt-name="${prompt.name}">
                ${prompt.name}
            </div>
        `).join('');
        
        // 绑定点击事件
        subMenu.querySelectorAll('.context-submenu-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                const promptName = item.dataset.promptName;
                try {
                    await selectPrompt(promptName);
                    hideContextMenu();
                } catch (error) {
                    alert('选择提示词失败: ' + error.message);
                }
            });
        });
    }
    
    /**
     * 渲染视窗布局子菜单
     */
    function renderLayoutSubMenu() {
        if (currentSubMenuType !== 'layout') return;
        
        if (!state.layouts || state.layouts.length === 0) {
            subMenu.innerHTML = '<div style="padding: 10px; color: var(--text-muted);">暂无布局</div>';
            return;
        }
        
        subMenu.innerHTML = state.layouts.map(layout => `
            <div class="context-submenu-item" data-layout-name="${layout.name}">
                ${layout.name}
            </div>
        `).join('');
        
        // 绑定点击事件
        subMenu.querySelectorAll('.context-submenu-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                const layoutName = item.dataset.layoutName;
                try {
                    await selectLayout(layoutName);
                    hideContextMenu();
                } catch (error) {
                    alert('选择布局失败: ' + error.message);
                }
            });
        });
    }

    /**
     * 渲染事件子菜单
     */
    function renderEventSubMenu() {
        if (currentSubMenuType !== 'event') return;
        
        // 先显示事件列表和批量执行选项
        let menuHTML = '';
        
        if (!state.events || state.events.length === 0) {
            menuHTML = '<div style="padding: 10px; color: var(--text-muted);">暂无事件</div>';
        } else {
            menuHTML = state.events.map(event => `
                <div class="context-submenu-item" data-event-name="${event.name}">
                    ${event.name}
                </div>
            `).join('');
        }
        
        // 添加批量执行选项（分隔线 + 批量执行 + 反馈系统管理面板）
        menuHTML += `
            <div style="height: 1px; background: var(--border); margin: 4px 0;"></div>
            <div class="context-submenu-item" data-action="batch-execute" style="color: var(--accent-blue);">
                📦 批量执行
            </div>
            <div class="context-submenu-item" data-action="open-usage-panel" style="color: var(--accent-green);">
                📊 打开反馈系统面板
            </div>
        `;
        
        subMenu.innerHTML = menuHTML;
        
        // 绑定点击事件
        subMenu.querySelectorAll('.context-submenu-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                const eventName = item.dataset.eventName;
                const action = item.dataset.action;
                
                if (action === 'batch-execute') {
                    // 打开批量执行面板
                    hideContextMenu();
                    const btnBatch = document.getElementById('btn-batch');
                    if (btnBatch) {
                        btnBatch.click();
                    }
                    return;
                }
                
                if (action === 'open-usage-panel') {
                    // 打开反馈系统管理面板，而不是统计面板
                    hideContextMenu();
                    if (window.openFeedbackPanel) {
                        window.openFeedbackPanel();
                    } else {
                        alert('反馈系统管理面板未初始化，请刷新页面后重试');
                    }
                    return;
                }
                
                if (!eventName) return;
                
                try {
                    hideContextMenu();
                    
                    // 询问执行模式
                    const executionMode = confirm(`是否使用并发执行模式执行事件 "${eventName}"？\n\n点击"确定"使用并发执行（更快，但可能消耗更多资源）\n点击"取消"使用顺序执行（较慢，但更稳定）`);
                    const concurrency = executionMode ? 3 : 1;
                    const sequential = !executionMode;
                    
                    const result = await executeEvent(eventName, {
                        concurrency: concurrency,
                        sequential: sequential
                    });

                    if (result && result.summary) {
                        /**
                         * 深度统计工作流的步骤数，包括工作流节点内部的步骤
                         * @param {Array} steps - 工作流步骤数组
                         * @returns {Object} 统计结果 {totalSteps: 总步骤数, workflowNodeCount: 工作流节点数量, workflowNodes: 工作流节点数组}
                         */
                        const countStepsDeeply = (steps) => {
                            let totalSteps = 0;
                            let workflowNodeCount = 0;
                            const workflowNodes = [];
                            
                            if (!steps || !Array.isArray(steps)) {
                                return { totalSteps: 0, workflowNodeCount: 0, workflowNodes: [] };
                            }
                            
                            steps.forEach(step => {
                                // 检查是否是工作流节点
                                if (step.isWorkflowNode && step.workflowNodeInternalSteps) {
                                    workflowNodeCount++;
                                    const internalSteps = step.workflowNodeInternalSteps || [];
                                    const workflowNodeName = step.workflowNodeName || step.step || step.viewId || '未知工作流节点';
                                    
                                    // 递归统计内部步骤（包括嵌套的工作流节点）
                                    const internalStats = countStepsDeeply(internalSteps);
                                    
                                    workflowNodes.push({
                                        name: workflowNodeName,
                                        stepCount: internalStats.totalSteps // 工作流节点内部的总步骤数（包括嵌套）
                                    });
                                    
                                    // 工作流节点本身算作1个步骤，加上其内部的所有步骤
                                    totalSteps += 1 + internalStats.totalSteps;
                                } else {
                                    // 普通步骤
                                    totalSteps += 1;
                                }
                            });
                            
                            return { totalSteps, workflowNodeCount, workflowNodes };
                        };
                        
                        // 统计所有执行过的工作流
                        const workflowStats = new Map();
                        if (result.results && result.results.length > 0) {
                            result.results.forEach(fileResult => {
                                if (fileResult.workflowResult && fileResult.workflowResult.steps) {
                                    const workflowName = fileResult.summary?.workflow || '未知工作流';
                                    if (!workflowStats.has(workflowName)) {
                                        workflowStats.set(workflowName, {
                                            name: workflowName,
                                            totalStepCount: 0,  // 总步骤数（包括工作流节点内部）
                                            workflowNodeCount: 0, // 工作流节点数量
                                            workflowNodes: [], // 工作流节点列表
                                            fileCount: 0
                                        });
                                    }
                                    const stats = workflowStats.get(workflowName);
                                    
                                    // 使用深度统计函数统计所有步骤（包括工作流节点内部的步骤）
                                    const deepStats = countStepsDeeply(fileResult.workflowResult.steps);
                                    
                                    // 总步骤数（包括工作流节点内部的步骤，递归统计）
                                    stats.totalStepCount += deepStats.totalSteps;
                                    // 工作流节点数量
                                    stats.workflowNodeCount += deepStats.workflowNodeCount;
                                    // 工作流节点列表（合并）
                                    stats.workflowNodes.push(...deepStats.workflowNodes);
                                    stats.fileCount += 1;
                                }
                            });
                        }
                        
                        // 构建提示信息
                        let message = '事件执行成功！\n\n';
                        
                        // 显示所有执行过的工作流
                        if (workflowStats.size > 0) {
                            const workflowList = Array.from(workflowStats.values());
                            workflowList.forEach((stats, index) => {
                                if (index > 0) message += '\n';
                                
                                // 格式：现工作流名：本体工作流名
                                message += `现工作流名：${stats.name}\n`;
                                
                                // 如果有工作流节点，显示工作流节点信息
                                if (stats.workflowNodeCount > 0) {
                                    // 计算工作流节点内部的总步骤数
                                    const workflowNodeInternalStepCount = stats.workflowNodes.reduce((sum, node) => sum + node.stepCount, 0);
                                    message += `工作流节点有${stats.workflowNodeCount}个，共执行${workflowNodeInternalStepCount}步骤\n`;
                                }
                                
                                // 所有节点（包括工作流节点内部的步骤数）共执行x步骤
                                // message += `所有节点（包括工作流节点内部的步骤数）共执行${stats.totalStepCount}步骤`;
                            });
                        } else {
                            // 如果没有工作流统计信息，使用默认格式
                            const workflowName = result.summary.workflow || '未知工作流';
                            message += `现工作流名：${workflowName}\n`;
                            // message += `所有节点（包括工作流节点内部的步骤数）共执行${result.summary.totalSteps}步骤`;
                        }
                        
                        alert(message);
                    } else {
                        // 检查是否有后续工作流
                        if (state.workflowExecutionState && state.workflowExecutionState._pendingContinueWorkflow) {
                            console.log('工作流执行完毕，准备执行下一个工作流');
                        } else {
                            alert('工作流执行结束');
                        }
                    }
                } catch (error) {
                    if (error.message && error.message.includes('workflowName is not defined')) {
                        // 如果是workflowName未定义错误，在控制台显示错误，不弹窗
                        console.error('执行事件失败:', error);
                        console.error('错误详情: workflowName is not defined');
                        console.trace('调用堆栈:');
                        // 检查是否有后续工作流
                        if (state.workflowExecutionState && state.workflowExecutionState._pendingContinueWorkflow) {
                            console.log('工作流执行完毕，准备执行下一个工作流');
                        } else {
                            alert('工作流执行结束');
                        }
                    } else if (error.message && error.message.includes("Cannot read properties of undefined (reading 'summary')")) {
                        // 如果是summary未定义错误，在控制台显示错误，不弹窗
                        console.error('执行事件失败:', error);
                        console.error('错误详情: Cannot read properties of undefined (reading "summary")');
                        // 检查是否有后续工作流
                        if (state.workflowExecutionState && state.workflowExecutionState._pendingContinueWorkflow) {
                            console.log('工作流执行完毕，准备执行下一个工作流');
                        } else {
                            alert('工作流执行结束');
                        }
                    } else {
                        alert('执行事件失败: ' + error.message);
                    }
                }
            });
        });
    }
    
    /**
     * 渲染工作流子菜单
     */
    function renderWorkflowSubMenu() {
        if (currentSubMenuType !== 'workflow') return;
        
        if (!state.workflows || state.workflows.length === 0) {
            subMenu.innerHTML = '<div style="padding: 10px; color: var(--text-muted);">暂无工作流</div>';
            return;
        }
        
        subMenu.innerHTML = state.workflows.map(workflow => `
            <div class="context-submenu-item" data-workflow-name="${workflow.name}">
                ${workflow.name}
            </div>
        `).join('');
        
        // 绑定点击事件
        subMenu.querySelectorAll('.context-submenu-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                const workflowName = item.dataset.workflowName;
                try {
                    hideContextMenu();
                    
                    // 打开工作流管理面板并选择该工作流
                    const workflowPanel = document.getElementById('workflow-panel');
                    if (workflowPanel) {
                        workflowPanel.style.display = 'flex';
                        workflowPanel.focus();
                        await loadWorkflows();
                        
                        // 延迟选择工作流，确保面板已加载
                        setTimeout(async () => {
                            if (window.selectWorkflow) {
                                await window.selectWorkflow(workflowName);
                            }
                        }, 100);
                    }
                } catch (error) {
                    alert('打开工作流失败: ' + error.message);
                }
            });
        });
    }
    
    // 子菜单鼠标进入/离开处理
    subMenu.addEventListener('mouseenter', () => {
        if (subMenuTimeout) {
            clearTimeout(subMenuTimeout);
            subMenuTimeout = null;
        }
    });
    
    subMenu.addEventListener('mouseleave', () => {
        subMenuTimeout = setTimeout(() => {
            subMenu.style.display = 'none';
            currentSubMenuType = null;
        }, 200);
    });
    
    // 使用事件委托，在 document 的捕获阶段拦截主界面 viewer-grid 区域的所有右键事件
    // 注意：只拦截主界面的 viewer-grid，不影响事件面板中的 ai-viewer-grid
    document.addEventListener('contextmenu', (e) => {
        // 关键修复：添加安全检查，避免在 contextMenu 或 subMenu 未初始化时访问
        if (!contextMenu || !subMenu || !document.body.contains(contextMenu) || !document.body.contains(subMenu)) {
            return; // 如果菜单未初始化，直接返回，避免错误
        }
        
        // 检查是否点击在主界面的 viewer-grid 或其子元素上
        const target = e.target;
        const eventPanel = document.getElementById('event-panel');
        
        // 确保不在事件面板中（事件面板有自己的AI查看器）
        if (eventPanel && eventPanel.contains(target)) {
            return; // 事件面板中的右键事件不处理
        }
        
        // 确保只在主界面的 viewer-grid 区域
        if (viewerGrid && (viewerGrid.contains(target) || target === viewerGrid)) {
            // 排除右键菜单本身和子菜单
            if (!contextMenu.contains(target) && !subMenu.contains(target)) {
                e.preventDefault();
                e.stopPropagation();
                showContextMenu(e.clientX, e.clientY);
            }
        }
    }, true); // 使用捕获阶段，确保优先处理，阻止浏览器默认右键菜单
    
    // 点击其他地方隐藏菜单
    // 关键修复：添加安全检查，避免在 contextMenu 或 subMenu 未初始化时访问
    document.addEventListener('click', (e) => {
        // 检查 contextMenu 和 subMenu 是否存在且已添加到 DOM
        if (!contextMenu || !subMenu || !document.body.contains(contextMenu) || !document.body.contains(subMenu)) {
            return; // 如果菜单未初始化，直接返回，避免错误
        }
        if (!contextMenu.contains(e.target) && !subMenu.contains(e.target)) {
            hideContextMenu();
        }
    });
    
    // ESC键隐藏菜单
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && contextMenu.style.display === 'block') {
            hideContextMenu();
        }
    });
    
    /**
     * 打开管理面板
     * @param {string} type - 面板类型
     */
    function openManagementPanel(type) {
        // 根据类型打开对应的管理面板
        switch (type) {
            case 'prompt':
                // 打开提示词管理面板
                const btnPrompt = document.getElementById('btn-prompt');
                if (btnPrompt) {
                    btnPrompt.click();
                }
                break;
            case 'layout':
                // 打开布局管理面板
                const btnLayout = document.getElementById('btn-layout');
                if (btnLayout) {
                    btnLayout.click();
                }
                break;
            case 'event':
                // 打开事件管理面板
                const btnEvent = document.getElementById('btn-event');
                if (btnEvent) {
                    btnEvent.click();
                }
                break;
            case 'workflow':
                // 打开工作流管理面板
                const btnWorkflow = document.getElementById('btn-workflow');
                if (btnWorkflow) {
                    btnWorkflow.click();
                }
                break;
            case 'new':
                // 新建菜单没有对应的面板，保持原有行为（显示子菜单）
                // 这里不做处理，让子菜单正常显示
                break;
            default:
                console.log('未知的面板类型:', type);
        }
    }
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.initContextMenu = initContextMenu;
}

