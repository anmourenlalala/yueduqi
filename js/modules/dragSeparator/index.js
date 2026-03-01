/**
 * 拖拽分离控制器
 * 负责处理视图的拖拽分离功能
 */

import { hideViewContainer, showViewContainer, getViewContainer } from '../../utils/viewContainerWrapper.js';
import { createViewSnapshot, serializeSnapshot } from './stateSnapshot.js';
import { createSeparatedWindow } from './windowCreator.js';
import { establishChannel, sendMessage, onMessage, closeChannel } from './communication.js';
import { state } from '../../core/state.js';

// 存储分离状态
const separatedViews = new Map(); // {viewId: {window, channelId, snapshot}}

/**
 * 通知分离窗口刷新DOM
 * @param {string} viewId - 视图ID
 */
export async function notifySeparatedWindowRefresh(viewId) {
    const separated = separatedViews.get(viewId);
    if (separated && separated.channelId) {
        sendMessage(separated.channelId, 'VIEW_CONTENT_REFRESHED', { viewId });
        console.log(`[主窗口] 已通知分离窗口刷新视图 ${viewId}`);
    } else {
        console.log(`[主窗口] 视图 ${viewId} 未分离，无需通知`);
    }
}


/**
 * 初始化拖拽分离功能
 */
export function initDragSeparator() {
    // 为所有视图添加拖拽手柄
    addDragHandles();
    
    // 监听页面关闭，清理资源
    window.addEventListener('beforeunload', () => {
        separatedViews.forEach(({ channelId }) => {
            closeChannel(channelId);
        });
    });
    
    // 监听文件切换，同步到分离窗口
    setupFileChangeListener();
    
    // 监听来自分离窗口的消息（键盘事件）
    // 使用防抖机制，避免重复处理
    let lastKeydownTime = 0;
    let lastKeydownKey = null;
    const KEYDOWN_DEBOUNCE = 100; // 100ms内的重复消息只处理一次
    
    window.addEventListener('message', async (event) => {
        // 安全检查：只接受同源消息
        if (event.origin !== window.location.origin) {
            return;
        }
        
        if (event.data && event.data.type === 'SEPARATED_VIEW_KEYDOWN') {
            const key = event.data.key;
            const now = Date.now();
            
            // 防抖：如果100ms内收到相同的按键消息，只处理第一次
            if (key === lastKeydownKey && (now - lastKeydownTime) < KEYDOWN_DEBOUNCE) {
                console.log(`[主窗口] 忽略重复的键盘事件: ${key} (防抖)`);
                return;
            }
            
            lastKeydownTime = now;
            lastKeydownKey = key;
            
            console.log(`[主窗口] 收到分离窗口的键盘事件: ${key}`);
            
            // 处理 w、s 键：切换文件
            if (key === 'w' || key === 's') {
                const { moveSelection } = await import('../fileManager.js');
                const step = key === 'w' ? -1 : 1;
                moveSelection(step);
                
                // 等待选择完成后，如果选中的是文件，自动打开
                setTimeout(() => {
                    if (state.selectedIndex >= 0 && state.currentFileItem && !state.currentFileItem.isDir) {
                        if (window.selectFile) {
                            window.selectFile(state.currentFileItem.el, state.currentFileItem.path);
                        }
                    }
                }, 50);
            }
            // 处理 e 键：执行 enter 功能（直接触发键盘事件，让主窗口的 keyboardHandler 处理）
            else if (key === 'e') {
                const keyboardEvent = new KeyboardEvent('keydown', {
                    key: 'e',
                    code: 'KeyE',
                    bubbles: true,
                    cancelable: true
                });
                document.dispatchEvent(keyboardEvent);
            }
            // 处理 q 键：返回上一个文件或目录（直接触发键盘事件，让主窗口的 keyboardHandler 处理）
            else if (key === 'q') {
                const keyboardEvent = new KeyboardEvent('keydown', {
                    key: 'q',
                    code: 'KeyQ',
                    bubbles: true,
                    cancelable: true
                });
                document.dispatchEvent(keyboardEvent);
            }
        } else if (event.data && event.data.type === 'SEPARATED_VIEW_THEME_TOGGLE') {
            // 处理分离窗口发来的主题切换请求（由主窗口统一切换并广播到所有分离窗口）
            console.log('[主窗口] 收到分离窗口的主题切换请求');
            // 注意：dragSeparator 位于 js/modules/dragSeparator/，themeManager 在 js/modules/ 下一级
            // 因此这里的相对路径应为 ../themeManager.js，而不是 ../modules/themeManager.js
            const { toggleThemeMode } = await import('../themeManager.js');
            toggleThemeMode();
        }
    });
    
    // 定期检查分离窗口是否已关闭（用于处理异常关闭的情况）
    setInterval(() => {
        separatedViews.forEach(({ window: separatedWindow, channelId }, viewId) => {
            if (separatedWindow && separatedWindow.closed) {
                console.log(`检测到分离窗口已关闭: ${viewId}`);
                // 窗口已关闭，恢复视图
                restoreView(viewId);
            }
        });
    }, 1000); // 每秒检查一次
    
    console.log('拖拽分离功能已初始化');
}

/**
 * 向所有分离窗口广播字体大小变更
 * @param {string} fontSize 像素值字符串，如 "15px"
 */
export function broadcastFontSizeChange(fontSize) {
    if (!fontSize) return;
    if (separatedViews.size === 0) return;

    separatedViews.forEach(({ channelId }, viewId) => {
        try {
            sendMessage(channelId, 'FONT_SIZE_CHANGED', {
                viewId,
                fontSize
            });
        } catch (e) {
            console.warn('[拖拽分离] 向分离窗口广播字体大小失败:', e);
        }
    });
}

/**
 * 向所有分离窗口广播主题模式变更（light/dark）
 * @param {string} themeMode
 */
export function broadcastThemeModeChange(themeMode) {
    if (!themeMode) return;
    if (separatedViews.size === 0) return;

    separatedViews.forEach(({ channelId }, viewId) => {
        try {
            sendMessage(channelId, 'THEME_MODE_CHANGED', {
                viewId,
                themeMode
            });
        } catch (e) {
            console.warn('[拖拽分离] 向分离窗口广播主题模式失败:', e);
        }
    });
}

/**
 * 为视图添加拖拽手柄
 */
function addDragHandles() {
    // 使用事件委托，监听所有视图容器的拖拽
    const viewerGrid = document.getElementById('viewer-grid');
    if (!viewerGrid) return;
    
    viewerGrid.addEventListener('mousedown', handleDragStart);
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
}

let dragState = {
    isDragging: false,
    viewId: null,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    threshold: 100 // 拖拽超过100px才触发分离
};

/**
 * 处理拖拽开始
 */
function handleDragStart(e) {
    // 检查是否点击在拖拽手柄上
    const dragHandle = e.target.closest('.view-drag-handle');
    if (!dragHandle) return;
    
    const container = dragHandle.closest('.view-container');
    if (!container) return;
    
    const viewId = container.dataset.viewId;
    if (!viewId) return;
    
    dragState.isDragging = true;
    dragState.viewId = viewId;
    dragState.startX = e.clientX;
    dragState.startY = e.clientY;
    dragState.currentX = e.clientX;
    dragState.currentY = e.clientY;
    
    // 添加拖拽样式
    container.classList.add('dragging');
    
    e.preventDefault();
}

/**
 * 处理拖拽移动
 */
function handleDragMove(e) {
    if (!dragState.isDragging) return;
    
    dragState.currentX = e.clientX;
    dragState.currentY = e.clientY;
    
    const deltaX = Math.abs(dragState.currentX - dragState.startX);
    const deltaY = Math.abs(dragState.currentY - dragState.startY);
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    // 不再显示分离提示框
}

/**
 * 处理拖拽结束
 */
async function handleDragEnd(e) {
    if (!dragState.isDragging) return;
    
    const distance = Math.sqrt(
        Math.pow(dragState.currentX - dragState.startX, 2) +
        Math.pow(dragState.currentY - dragState.startY, 2)
    );
    
    // 移除拖拽样式
    const container = getViewContainer(dragState.viewId);
    if (container) {
        container.classList.remove('dragging');
    }
    
    // 如果超过阈值，执行分离
    if (distance > dragState.threshold) {
        await separateView(dragState.viewId);
    }
    
    // 重置拖拽状态
    dragState.isDragging = false;
    dragState.viewId = null;
}


/**
 * 分离视图
 */
async function separateView(viewId) {
    try {
        console.log(`开始分离视图 ${viewId}...`);
        
        // 1. 创建快照
        const snapshot = await createViewSnapshot(viewId);
        const serialized = serializeSnapshot(snapshot);
        
        // 2. 创建分离窗口
        let separatedWindow;
        try {
            separatedWindow = await createSeparatedWindow(serialized, {
                width: snapshot.uiState.containerSize?.width || 800,
                height: snapshot.uiState.containerSize?.height || 600
            });
        } catch (error) {
            throw new Error('创建分离窗口失败: ' + error.message);
        }
        
        if (!separatedWindow) {
            throw new Error('创建分离窗口失败');
        }
        
        // 3. 建立通信通道（使用快照时间戳确保一致性）
        const channelId = `view-separator-${viewId}-${snapshot.timestamp}`;
        console.log(`[分离视图] 建立通信通道: ${channelId}`);
        establishChannel(channelId);
        
        // 4. 监听恢复消息
        onMessage(channelId, async (message) => {
            if (message.type === 'VIEW_RESTORED' || message.type === 'PAGE_CLOSING') {
                console.log(`收到恢复消息: ${message.type}, viewId: ${viewId}`);
                await restoreView(viewId);
            } else if (message.type === 'FILE_CHANGED') {
                // 分离窗口通知文件切换，主窗口需要更新
                console.log('分离窗口文件已切换:', message.data);
            } else if (message.type === 'VIEW_CONTENT_REFRESHED') {
                // 分离窗口通知内容已刷新，主窗口需要刷新DOM
                console.log(`[主窗口] 收到分离窗口刷新通知，视图ID: ${message.viewId}`);
                const { loadSingleView } = await import('../viewManager.js');
                await loadSingleView(message.viewId);
            }
        });
        
        // 5. 隐藏原页面视图
        hideViewContainer(viewId);
        
        // 6. 发送分离消息（分离窗口建立通道后会收到此消息）
        sendMessage(channelId, 'VIEW_SEPARATED', { viewId, snapshot });
        
        // 7. 记录分离状态
        separatedViews.set(viewId, {
            window: separatedWindow,
            channelId: channelId,
            snapshot: snapshot
        });
        
        console.log(`[分离视图] 已记录分离状态，当前分离窗口数量: ${separatedViews.size}`);
        
        console.log(`视图 ${viewId} 分离成功`);
        
    } catch (error) {
        console.error('分离视图失败:', error);
        alert('分离失败: ' + error.message);
    }
}

/**
 * 恢复视图
 */
async function restoreView(viewId) {
    console.log(`恢复视图 ${viewId}...`);
    
    // 1. 显示原页面视图
    const restored = showViewContainer(viewId);
    if (!restored) {
        console.warn(`视图 ${viewId} 容器不存在，可能已被删除`);
        return;
    }
    
    // 2. 清理分离状态
    const separated = separatedViews.get(viewId);
    if (separated) {
        // 检查窗口是否还存在
        if (separated.window && !separated.window.closed) {
            // 窗口还存在，尝试关闭它
            try {
                separated.window.close();
            } catch (e) {
                console.warn('关闭分离窗口失败:', e);
            }
        }
        closeChannel(separated.channelId);
        separatedViews.delete(viewId);
    }
    
    // 3. 重新加载视图内容（确保内容正确显示）
    try {
        const { loadSingleView } = await import('../modules/viewManager.js');
        await loadSingleView(viewId);
        console.log(`视图 ${viewId} 内容已重新加载`);
    } catch (error) {
        console.error(`重新加载视图 ${viewId} 内容失败:`, error);
    }
    
    console.log(`视图 ${viewId} 恢复成功`);
}

/**
 * 设置文件切换监听
 */
function setupFileChangeListener() {
    // 监听state.originalPath的变化
    let lastOriginalPath = state.originalPath;
    
    // 使用Proxy监听state变化
    const originalPathProxy = new Proxy(state, {
        set(target, prop, value) {
            if (prop === 'originalPath' && value !== lastOriginalPath) {
                lastOriginalPath = value;
                // 通知所有分离窗口文件已切换
                separatedViews.forEach(({ channelId }, viewId) => {
                    sendMessage(channelId, 'FILE_CHANGED', {
                        originalPath: value,
                        viewId: viewId
                    });
                });
            }
            target[prop] = value;
            return true;
        }
    });
    
    // 替换state引用（注意：这需要谨慎处理）
    // 实际上，我们通过监听loadFileViews调用来实现
}

/**
 * 通知分离窗口文件已切换
 */
export function notifySeparatedWindowsFileChange(originalPath) {
    if (separatedViews.size === 0) {
        console.log('[文件切换通知] 没有分离的窗口，跳过通知');
        return;
    }
    
    console.log(`[文件切换通知] 开始通知 ${separatedViews.size} 个分离窗口，新文件路径: ${originalPath}`);
    console.log(`[文件切换通知] 当前视图配置数量: ${state.views ? state.views.length : 0}`);
    
    separatedViews.forEach(({ channelId }, viewId) => {
        console.log(`[文件切换通知] 发送 FILE_CHANGED 消息到视图 ${viewId}，通道 ${channelId}`);
        sendMessage(channelId, 'FILE_CHANGED', {
            originalPath: originalPath,
            viewId: viewId,
            allViews: state.views ? [...state.views] : [] // 发送所有视图配置的副本，确保分离窗口能正确计算文件路径
        });
    });
    
    console.log('[文件切换通知] 所有通知已发送');
}

