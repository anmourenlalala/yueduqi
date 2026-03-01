/**
 * AI工作流内容查看器
 * 完全依赖2333端口主界面的状态，不维护自己的状态
 * 只负责显示，所有配置和文件路径都从主界面动态读取
 */

import { getFile, saveFile } from './core/api.js';
import { processContent } from './utils/markdownConverter.js';
import { isSupportedFileType, getFileBaseName, getFileExtension } from './utils/fileUtils.js';
import { enhanceTables } from './modules/tableEditor.js';
import { attachJumpLinkListeners } from './modules/editor.js';

// marked和DOMPurify是全局的，从CDN加载
const marked = window.marked;
const DOMPurify = window.DOMPurify;

// 本地状态（仅用于显示）
let rawContents = {};
let scrollPositions = {};
let panePaths = {};

/**
 * 从localStorage读取主界面的配置（实时读取，不缓存）
 */
function getMainConfig() {
    // 读取视图配置
    const savedViews = localStorage.getItem('views');
    let views = [];
    if (savedViews) {
        views = JSON.parse(savedViews);
        views.forEach(view => {
            if (view.suffix === undefined || view.suffix === null) {
                view.suffix = '';
            }
        });
    } else {
        // 默认视图配置（如果主界面还没有配置）
        views = [
            {id: 'original', titleTemplate: '原始文本：{filename}', suffix: '', keybind: 'a'},
            {id: 'analysis', titleTemplate: '分析文本：{filename}', suffix: '_analysis', keybind: 'd'}
        ];
    }
    
    // 读取布局配置
    const savedSelectedLayout = localStorage.getItem('selectedLayout');
    let selectedLayout = null;
    if (savedSelectedLayout) {
        try {
            selectedLayout = JSON.parse(savedSelectedLayout);
        } catch (e) {
            console.error('Failed to parse saved selected layout:', e);
        }
    }
    
    return { views, selectedLayout };
}

/**
 * 从localStorage读取主界面当前文件路径
 */
function getCurrentMainFile() {
    return localStorage.getItem('currentMainFile');
}

/**
 * 应用布局配置（从主界面读取）
 */
function applyLayout() {
    const grid = document.getElementById('ai-viewer-grid');
    if (!grid) {
        console.warn('[AI查看器] 视图网格元素未找到');
        return;
    }
    
    const { selectedLayout } = getMainConfig();
    console.log('[AI查看器] 当前布局配置:', selectedLayout);
    
    if (selectedLayout && selectedLayout.columns) {
        grid.style.gridTemplateColumns = `repeat(${selectedLayout.columns}, 1fr)`;
        console.log(`[AI查看器] 应用布局: ${selectedLayout.columns}列`);
    } else {
        // 默认两列
        grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
        console.log('[AI查看器] 使用默认布局: 2列');
    }
}

/**
 * 渲染视图网格（从主界面配置动态读取）
 */
function renderViewerGrid() {
    const grid = document.getElementById('ai-viewer-grid');
    if (!grid) return;
    
    const { views } = getMainConfig();
    
    grid.innerHTML = '';
    
    views.forEach((view, index) => {
        const pane = document.createElement('div');
        pane.className = 'pane';
        pane.innerHTML = `
            <div class="pane-bar">
                <span id="ai-title-${view.id}">${view.titleTemplate.replace('{filename}', '')}</span>
                <div style="display: flex; align-items: center; gap: 4px;">
                    <button class="ai-view-paste-btn" data-view-id="${view.id}" style="background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-muted); cursor: pointer; font-size: 12px; width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" title="粘贴到此视图">📄</button>
                    <button class="ai-view-copy-btn" data-view-id="${view.id}" style="background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-muted); cursor: pointer; font-size: 12px; width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" title="复制此视图内容">📋</button>
                    <span class="ai-view-paste-ok" data-view-id="${view.id}" style="font-size: 11px; font-weight: bold; color: var(--accent); opacity: 0; transition: opacity 0.2s;">OK</span>
                </div>
            </div>
            <div class="pane-content md-render" id="ai-view-${view.id}"></div>
        `;
        grid.appendChild(pane);
        
        // 为每个视图添加滚动事件监听
        const paneContent = document.getElementById(`ai-view-${view.id}`);
        if (paneContent) {
            paneContent.addEventListener('scroll', function() {
                if (!scrollPositions) scrollPositions = {};
                scrollPositions[view.id] = this.scrollTop;
            });
        }
        
        // 为粘贴按钮添加事件监听器
        const pasteBtn = pane.querySelector('.ai-view-paste-btn');
        if (pasteBtn) {
            pasteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const radio = document.querySelector(`input[name="ai-paste-target"][value="${view.id}"]`);
                if (radio) {
                    radio.checked = true;
                }
                await handlePaste();
            });
            
            pasteBtn.addEventListener('mouseenter', function() {
                this.style.background = 'var(--accent-bg)';
                this.style.borderColor = 'var(--accent-blue)';
                this.style.color = 'var(--accent-blue)';
            });
            
            pasteBtn.addEventListener('mouseleave', function() {
                this.style.background = 'var(--bg-tertiary)';
                this.style.borderColor = 'var(--border)';
                this.style.color = 'var(--text-muted)';
            });
        }
        
        // 为复制按钮添加事件监听器
        const copyBtn = pane.querySelector('.ai-view-copy-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                copyViewContent(view.id);
            });
            
            copyBtn.addEventListener('mouseenter', function() {
                this.style.background = 'var(--accent-bg)';
                this.style.borderColor = 'var(--accent-blue)';
                this.style.color = 'var(--accent-blue)';
            });
            
            copyBtn.addEventListener('mouseleave', function() {
                this.style.background = 'var(--bg-tertiary)';
                this.style.borderColor = 'var(--border)';
                this.style.color = 'var(--text-muted)';
            });
        }
    });
    
    // 应用布局
    applyLayout();
}

/**
 * 渲染粘贴目标选择器（从主界面配置动态读取）
 */
function renderPasteTargets() {
    const container = document.getElementById('ai-paste-targets-container');
    if (!container) return;
    
    const { views } = getMainConfig();
    
    // 保留标题，添加选择器
    container.innerHTML = '<span style="font-size: 11px; font-weight: bold; color: var(--text-muted);">Ctrl+V:</span>';
    
    views.forEach((view, index) => {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.gap = '5px';
        div.innerHTML = `
            <label class="toggle-switch">
                <input type="radio" name="ai-paste-target" value="${view.id}" ${index === 0 ? 'checked' : ''}>
                <span class="toggle-slider"></span>
            </label>
            <span style="font-size: 11px; font-weight: bold; color: var(--accent);">${view.id}</span>
        `;
        container.appendChild(div);
    });
}

/**
 * 加载文件视图（带_ai后缀，从主界面当前文件动态读取）
 */
async function loadFileViews(basePath) {
    if (!basePath) {
        console.warn('[AI查看器] 文件路径为空，跳过加载');
        return;
    }
    
    console.log('[AI查看器] 开始加载文件:', basePath);
    
    const { views } = getMainConfig();
    const baseName = getFileBaseName(basePath);
    const ext = getFileExtension(basePath);
    
    console.log('[AI查看器] 视图数量:', views.length);
    
    for (const view of views) {
        const viewId = view.id;
        let targetPath;
        
        if (view.suffix) {
            // 如果有suffix，构建路径：文件名_suffix_ai.扩展名
            targetPath = basePath.replace(baseName + ext, baseName + view.suffix + '_ai' + ext);
        } else {
            // 如果没有suffix，构建路径：文件名_ai.扩展名
            targetPath = basePath.replace(baseName + ext, baseName + '_ai' + ext);
        }
        
        panePaths[viewId] = targetPath;
        console.log(`[AI查看器] 视图 ${viewId} 目标路径:`, targetPath);
        
        const viewEl = document.getElementById(`ai-view-${viewId}`);
        if (!viewEl) {
            console.warn(`[AI查看器] 视图元素未找到: ai-view-${viewId}`);
            continue;
        }
        
        // 恢复滚动位置
        if (scrollPositions[viewId]) {
            viewEl.scrollTop = scrollPositions[viewId];
        } else {
            viewEl.scrollTop = 0;
        }
        
        if (!isSupportedFileType(targetPath)) {
            viewEl.innerHTML = `<div style="color:var(--text-muted); padding:20px; font-style:italic; font-size:13px;">不支持的文件类型（仅支持 .txt 和 .md）</div>`;
            rawContents[viewId] = "**不支持的文件类型**";
        } else {
            try {
                const content = await getFile(targetPath);
                if (content.trim().startsWith('{') && content.includes('"error"')) {
                    rawContents[viewId] = '';
                    viewEl.innerHTML = `<div style="color:var(--text-muted); padding:20px; font-style:italic; font-size:13px;">文件未找到 (Ctrl+V创建)</div>`;
                    console.log(`[AI查看器] 视图 ${viewId} 文件未找到`);
                } else {
                    rawContents[viewId] = content;
                    const html = processContent(marked.parse(content));
                    viewEl.innerHTML = DOMPurify.sanitize(html);
                    
                    // 增强表格和跳转链接
                    enhanceTables();
                    attachJumpLinkListeners(viewEl);
                    console.log(`[AI查看器] 视图 ${viewId} 内容已加载`);
                }
            } catch (error) {
                rawContents[viewId] = '';
                viewEl.innerHTML = `<div style="color:var(--text-muted); padding:20px; font-style:italic; font-size:13px;">文件未找到 (Ctrl+V创建)</div>`;
                console.error(`[AI查看器] 视图 ${viewId} 加载失败:`, error);
            }
        }
    }
    
    console.log('[AI查看器] 文件加载完成');
}

/**
 * 检查并请求剪贴板权限
 * @returns {Promise<boolean>} 是否有权限
 */
async function checkAndRequestClipboardPermission() {
    // 检查是否支持 Clipboard API
    if (!navigator.clipboard || !navigator.clipboard.readText) {
        alert('您的浏览器不支持剪贴板访问功能');
        return false;
    }
    
    // 检查权限状态
    let permissionStatus = null;
    try {
        // 尝试使用 Permissions API 检查权限
        if (navigator.permissions && navigator.permissions.query) {
            permissionStatus = await navigator.permissions.query({ name: 'clipboard-read' });
        }
    } catch (err) {
        // 某些浏览器可能不支持 clipboard-read 权限查询，这是正常的
        console.log('无法查询剪贴板权限状态（某些浏览器不支持）:', err);
    }
    
    // 检查今天是否已经请求过权限
    const today = new Date().toDateString();
    const lastPermissionRequestDate = localStorage.getItem('lastClipboardPermissionRequestDate');
    const hasRequestedToday = lastPermissionRequestDate === today;
    
    // 如果权限状态是 'denied'（已拒绝），提示用户
    if (permissionStatus && permissionStatus.state === 'denied') {
        alert(
            '剪贴板访问权限已被拒绝。\n\n' +
            '请在浏览器设置中允许此网站访问剪贴板，然后刷新页面重试。\n\n' +
            'Chrome/Edge: 地址栏左侧的锁图标 → 网站设置 → 剪贴板 → 允许\n' +
            'Firefox: 地址栏左侧的锁图标 → 更多信息 → 权限 → 剪贴板 → 允许'
        );
        return false;
    }
    
    // 如果权限状态是 'prompt'（需要请求）且今天还没请求过，显示提示
    if (permissionStatus && permissionStatus.state === 'prompt' && !hasRequestedToday) {
        // 记录今天已请求过权限
        localStorage.setItem('lastClipboardPermissionRequestDate', today);
        
        // 显示权限请求提示（每天第一次粘贴时显示）
        const userConfirmed = confirm(
            '需要访问您的剪贴板才能粘贴内容。\n\n' +
            '点击"确定"后，浏览器会弹出权限请求对话框，请选择"允许"。\n\n' +
            '如果权限被拒绝，您可以在浏览器设置中手动授予权限。'
        );
        
        if (!userConfirmed) {
            return false;
        }
    }
    
    // 返回 true，允许继续尝试读取剪贴板
    // 如果还没有权限，浏览器会在 readText() 调用时自动弹出权限请求对话框
    return true;
}

/**
 * 处理粘贴
 */
async function handlePaste() {
    const currentFile = getCurrentMainFile();
    if (!currentFile) {
        alert('主界面未打开文件，请先在主界面选择文件');
        return;
    }
    
    const { views } = getMainConfig();
    const selectedRadio = document.querySelector('input[name="ai-paste-target"]:checked');
    if (!selectedRadio) {
        alert('请先选择粘贴目标视图');
        return;
    }
    
    const selectedPaneId = selectedRadio.value;
    const targetPath = panePaths[selectedPaneId];
    
    if (!targetPath) {
        alert('无法确定目标文件路径');
        return;
    }
    
    if (!isSupportedFileType(targetPath)) {
        alert('不支持的文件类型');
        return;
    }
    
    // 检查并请求剪贴板权限
    const hasPermission = await checkAndRequestClipboardPermission();
    if (!hasPermission) {
        return;
    }
    
    try {
        const content = await navigator.clipboard.readText();
        rawContents[selectedPaneId] = content;
        
        const html = processContent(marked.parse(content));
        const viewEl = document.getElementById(`ai-view-${selectedPaneId}`);
        if (viewEl) {
            viewEl.innerHTML = DOMPurify.sanitize(html);
            enhanceTables();
            attachJumpLinkListeners(viewEl);
        }
        
        await saveFile(targetPath, content);
        
        // 显示反馈效果
        if (viewEl) {
            viewEl.style.opacity = 0.5;
            setTimeout(() => viewEl.style.opacity = 1, 200);
        }
        
        const pasteOk = document.querySelector(`.ai-view-paste-ok[data-view-id="${selectedPaneId}"]`);
        if (pasteOk) {
            pasteOk.style.opacity = '1';
            setTimeout(() => {
                pasteOk.style.opacity = '0';
            }, 2000);
        }
    } catch (error) {
        console.error('粘贴失败:', error);
        
        // 如果是权限错误，提供更详细的提示
        if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
            alert(
                '粘贴失败：剪贴板访问权限被拒绝。\n\n' +
                '请在浏览器设置中允许此网站访问剪贴板，然后刷新页面重试。\n\n' +
                'Chrome/Edge: 地址栏左侧的锁图标 → 网站设置 → 剪贴板 → 允许\n' +
                'Firefox: 地址栏左侧的锁图标 → 更多信息 → 权限 → 剪贴板 → 允许'
            );
        } else {
            alert('粘贴失败: ' + error.message);
        }
    }
}

/**
 * 复制所有内容
 */
async function copyContent() {
    const currentFile = getCurrentMainFile();
    if (!currentFile) return;
    
    const { views } = getMainConfig();
    let allContent = '';
    views.forEach((view) => {
        const content = rawContents[view.id] || '';
        if (content) {
            const title = view.titleTemplate.replace('{filename}', getFileBaseName(currentFile));
            allContent += `# ${title}\n\n${content}\n\n---\n\n`;
        }
    });
    
    if (!allContent) {
        alert('没有可复制的内容');
        return;
    }
    
    try {
        await navigator.clipboard.writeText(allContent);
        alert('已复制所有内容到剪贴板');
    } catch (error) {
        console.error('复制失败:', error);
        alert('复制失败: ' + error.message);
    }
}

/**
 * 复制单个视图内容
 */
function copyViewContent(viewId) {
    const content = rawContents[viewId] || '';
    if (!content) {
        alert('该视图没有内容');
        return;
    }
    
    navigator.clipboard.writeText(content).then(() => {
        alert('已复制到剪贴板');
    }).catch(error => {
        console.error('复制失败:', error);
        alert('复制失败: ' + error.message);
    });
}

/**
 * 初始化键盘事件
 */
function initKeyboardHandler() {
    document.addEventListener('keydown', (e) => {
        // Ctrl+C 复制所有内容
        if (e.ctrlKey && e.key === 'c') {
            e.preventDefault();
            copyContent();
            return;
        }
        
        // Ctrl+V 粘贴
        if (e.ctrlKey && e.key === 'v') {
            // 检查是否在可编辑元素中
            const activeElement = document.activeElement;
            const isEditing = activeElement && (activeElement.isContentEditable || activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA');
            
            if (!isEditing) {
                e.preventDefault();
                handlePaste();
            }
            return;
        }
    });
}

/**
 * 监听主界面状态变化
 */
function watchMainState() {
    let lastFilePath = getCurrentMainFile();
    let lastViewsStr = '';
    let lastLayoutStr = '';
    
    // 初始化lastViews和lastLayout
    const initConfig = getMainConfig();
    lastViewsStr = JSON.stringify(initConfig.views);
    lastLayoutStr = JSON.stringify(initConfig.selectedLayout);
    
    // 使用storage事件监听localStorage变化（跨标签页/窗口）
    window.addEventListener('storage', (e) => {
        if (e.key === 'currentMainFile' && e.newValue !== lastFilePath) {
            lastFilePath = e.newValue;
            if (e.newValue) {
                loadFileViews(e.newValue);
            }
        }
        
        if (e.key === 'views') {
            const newViews = getMainConfig().views;
            const newViewsStr = JSON.stringify(newViews);
            if (newViewsStr !== lastViewsStr) {
                lastViewsStr = newViewsStr;
                renderViewerGrid();
                renderPasteTargets();
                if (lastFilePath) {
                    loadFileViews(lastFilePath);
                }
            }
        }
        
        if (e.key === 'selectedLayout') {
            const newLayout = getMainConfig().selectedLayout;
            const newLayoutStr = JSON.stringify(newLayout);
            if (newLayoutStr !== lastLayoutStr) {
                lastLayoutStr = newLayoutStr;
                applyLayout();
            }
        }
    });
    
    // 定期检查localStorage变化（同源情况下storage事件可能不触发）
    // 使用更频繁的轮询确保及时响应，实时跟随主界面
    setInterval(() => {
        const currentFile = getCurrentMainFile();
        const { views, selectedLayout } = getMainConfig();
        const newViewsStr = JSON.stringify(views);
        const newLayoutStr = JSON.stringify(selectedLayout);
        
        // 检查文件路径变化 - 实时跟随主界面
        if (currentFile !== lastFilePath) {
            if (currentFile) {
                console.log('[AI查看器] 检测到文件变化:', currentFile);
                lastFilePath = currentFile;
                loadFileViews(currentFile);
            } else if (lastFilePath) {
                // 主界面关闭了文件，清空显示
                console.log('[AI查看器] 主界面关闭文件，清空显示');
                lastFilePath = null;
                const { views } = getMainConfig();
                views.forEach(view => {
                    const viewEl = document.getElementById(`ai-view-${view.id}`);
                    if (viewEl) {
                        viewEl.innerHTML = '<div style="color:var(--text-muted); padding:20px; font-style:italic; font-size:13px;">等待主界面打开文件...</div>';
                        rawContents[view.id] = '';
                    }
                });
            }
        }
        
        // 检查视图配置变化 - 实时跟随主界面
        if (newViewsStr !== lastViewsStr) {
            console.log('[AI查看器] 检测到视图配置变化');
            lastViewsStr = newViewsStr;
            renderViewerGrid();
            renderPasteTargets();
            // 如果当前有文件打开，重新加载
            if (currentFile) {
                loadFileViews(currentFile);
            }
        }
        
        // 检查布局配置变化 - 实时跟随主界面
        if (newLayoutStr !== lastLayoutStr) {
            console.log('[AI查看器] 检测到布局配置变化');
            lastLayoutStr = newLayoutStr;
            applyLayout();
        }
    }, 100); // 每100ms检查一次，确保实时跟随
}

/**
 * 初始化应用
 */
async function initApp() {
    console.log('[AI查看器] 初始化开始');
    
    // 渲染视图网格（从主界面配置读取）
    renderViewerGrid();
    console.log('[AI查看器] 视图网格已渲染');
    
    // 渲染粘贴目标（从主界面配置读取）
    renderPasteTargets();
    console.log('[AI查看器] 粘贴目标已渲染');
    
    // 应用布局（从主界面配置读取）
    applyLayout();
    console.log('[AI查看器] 布局已应用');
    
    // 初始化键盘事件
    initKeyboardHandler();
    console.log('[AI查看器] 键盘事件已初始化');
    
    // 监听主界面状态变化
    watchMainState();
    console.log('[AI查看器] 状态监听已启动');
    
    // 初始加载：从localStorage读取主界面当前文件
    const currentFile = getCurrentMainFile();
    console.log('[AI查看器] 当前主界面文件:', currentFile);
    if (currentFile) {
        await loadFileViews(currentFile);
        console.log('[AI查看器] 文件已加载');
    } else {
        console.log('[AI查看器] 主界面未打开文件，等待主界面打开文件...');
    }
    
    // 暴露全局函数
    window.loadFileViews = loadFileViews;
    window.handlePaste = handlePaste;
    window.copyContent = copyContent;
    window.copyViewContent = copyViewContent;
    
    console.log('[AI查看器] 初始化完成');
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
