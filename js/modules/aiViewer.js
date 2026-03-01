/**
 * AI文件查看器模块
 * 在事件管理面板中提供独立的AI文件查看功能
 */

import { state } from '../core/state.js';
import { getDirectory, getFile } from '../core/api.js';
import { processContent } from '../utils/markdownConverter.js';
import { isSupportedFileType, getFileFolderPath } from '../utils/fileUtils.js';
import { marked } from '../libs/marked.js';
import DOMPurify from '../libs/purify.js';

// 确保marked和DOMPurify可用
if (typeof marked === 'undefined') {
    console.warn('marked未加载，AI查看器可能无法正常工作');
}
if (typeof DOMPurify === 'undefined') {
    console.warn('DOMPurify未加载，AI查看器可能无法正常工作');
}

// AI查看器的独立状态
const aiViewerState = {
    currentDir: null,
    files: [],
    selectedIndex: -1,
    currentFileItem: null,
    dirStack: [],
    originalPath: null,
    rawContents: {},
    scrollPositions: {}
};

/**
 * 初始化AI查看器
 */
export function initAIViewer() {
    const closeBtn = document.getElementById('close-ai-viewer-btn');
    if (closeBtn) {
        closeBtn.onclick = () => {
            hideAIViewer();
        };
    }
    
    const upBtn = document.getElementById('ai-viewer-up-btn');
    if (upBtn) {
        upBtn.onclick = () => {
            goUpDirectory();
        };
    }
    
    // 初始化AI查看器的快捷键处理（屏蔽主界面快捷键）
    setupAIViewerKeyboard();
}

/**
 * 显示AI查看器
 * @param {string} basePath - 基础路径（原文件路径）
 */
export async function showAIViewer(basePath) {
    const section = document.getElementById('event-ai-viewer-section');
    
    if (!section) return;
    
    // 显示AI查看区域（现在在事件列表下方，不需要隐藏编辑区域）
    section.style.display = 'flex';
    
    // 获取AI文件所在目录（文件名文件夹）
    const aiDir = getFileFolderPath(basePath);
    aiViewerState.originalPath = basePath;
    
    // 加载AI文件目录
    await loadAIDirectory(aiDir);
    
    // 渲染视图
    renderAIViewerGrid();
}

/**
 * 隐藏AI查看器
 */
export function hideAIViewer() {
    const section = document.getElementById('event-ai-viewer-section');
    
    if (section) section.style.display = 'none';
    
    // 清理状态
    aiViewerState.currentDir = null;
    aiViewerState.files = [];
    aiViewerState.selectedIndex = -1;
    aiViewerState.currentFileItem = null;
    aiViewerState.dirStack = [];
    aiViewerState.originalPath = null;
    aiViewerState.rawContents = {};
}

/**
 * 加载AI文件目录
 */
async function loadAIDirectory(path) {
    try {
        const data = await getDirectory(path);
        aiViewerState.currentDir = data.path;
        renderAIFileList(data);
    } catch (error) {
        console.error('加载AI目录失败:', error);
        alert('加载AI目录失败: ' + error.message);
    }
}

/**
 * 渲染AI文件列表
 */
function renderAIFileList(data) {
    const list = document.getElementById('ai-viewer-file-list');
    if (!list) return;
    
    list.innerHTML = '';
    aiViewerState.files = [];
    aiViewerState.selectedIndex = -1;
    aiViewerState.currentFileItem = null;
    
    // 只显示AI相关文件（_AI.md, _步骤*.md等）和合并文件
    const aiFiles = data.files.filter(file => {
        const name = file.name.toLowerCase();
        return name.includes('_ai.') || 
               name.includes('_步骤') || 
               name.includes('步骤') ||
               name.includes(':') ||
               name.endsWith('_ai.md') ||
               name.endsWith('_ai.txt');
    });
    
    // 渲染目录
    data.directories.forEach(dir => {
        const li = createAIFileItem(dir.name, 'type-dir', dir.path, true);
        li.dataset.path = dir.path;
        li.ondblclick = () => {
            selectAIFolder(li, dir.path);
            loadAIDirectory(dir.path);
        };
        list.appendChild(li);
    });
    
    // 渲染AI文件
    aiFiles.forEach(file => {
        const li = createAIFileItem(file.name, 'type-file', file.path, false);
        li.dataset.path = file.path;
        li.onclick = () => {
            selectAIFile(li, file.path);
        };
        list.appendChild(li);
    });
}

/**
 * 创建AI文件列表项
 */
function createAIFileItem(text, typeClass, path, isDir) {
    const li = document.createElement('li');
    li.className = `file-item ${typeClass}`;
    li.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 6px 8px; cursor: pointer; border-radius: var(--border-radius);">
            <span class="item-name" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${text}</span>
        </div>
    `;
    
    li.onclick = () => {
        if (isDir) {
            selectAIFolder(li, path);
        } else {
            selectAIFile(li, path);
        }
    };
    
    aiViewerState.files.push({ el: li, path: path, isDir });
    return li;
}

/**
 * 选择AI文件夹
 */
function selectAIFolder(el, path) {
    aiViewerState.files.forEach(f => f.el.classList.remove('selected'));
    el.classList.add('selected');
    aiViewerState.selectedIndex = aiViewerState.files.findIndex(f => f.el === el);
    aiViewerState.currentFileItem = aiViewerState.files[aiViewerState.selectedIndex];
}

/**
 * 选择AI文件
 */
async function selectAIFile(el, path) {
    aiViewerState.files.forEach(f => f.el.classList.remove('selected'));
    el.classList.add('selected');
    aiViewerState.selectedIndex = aiViewerState.files.findIndex(f => f.el === el);
    aiViewerState.currentFileItem = aiViewerState.files[aiViewerState.selectedIndex];
    
    // 加载文件内容到第一个视图
    if (state.views.length > 0) {
        const viewId = state.views[0].id;
        await loadAIFileToView(path, viewId);
    }
}

/**
 * 加载AI文件到视图
 */
async function loadAIFileToView(filePath, viewId) {
    if (!isSupportedFileType(filePath)) {
        const viewEl = document.getElementById(`ai-view-${viewId}`);
        if (viewEl) {
            viewEl.innerHTML = '<div style="color:var(--text-muted); padding:20px; font-style:italic; font-size:13px;">不支持的文件类型</div>';
        }
        return;
    }
    
    try {
        const content = await getFile(filePath);
        aiViewerState.rawContents[viewId] = content;
        
        const viewEl = document.getElementById(`ai-view-${viewId}`);
        if (viewEl) {
            const html = processContent(marked.parse(content));
            viewEl.innerHTML = DOMPurify.sanitize(html);
            
            // 恢复滚动位置
            if (aiViewerState.scrollPositions[viewId]) {
                viewEl.scrollTop = aiViewerState.scrollPositions[viewId];
            }
            
            // 增强表格和跳转链接
            if (window.enhanceTables) window.enhanceTables();
            if (window.attachJumpLinkListeners) window.attachJumpLinkListeners(viewEl);
        }
    } catch (error) {
        console.error('加载AI文件失败:', error);
        const viewEl = document.getElementById(`ai-view-${viewId}`);
        if (viewEl) {
            viewEl.innerHTML = '<div style="color:var(--text-muted); padding:20px; font-style:italic; font-size:13px;">文件未找到</div>';
        }
    }
}

/**
 * 渲染AI查看器视图网格
 */
function renderAIViewerGrid() {
    const grid = document.getElementById('ai-viewer-grid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    state.views.forEach((view, index) => {
        const pane = document.createElement('div');
        pane.className = 'pane';
        pane.innerHTML = `
            <div class="pane-bar">
                <span id="ai-title-${view.id}">${view.titleTemplate.replace('{filename}', 'AI文件')}</span>
            </div>
            <div class="pane-content md-render" id="ai-view-${view.id}" style="overflow-y: auto;"></div>
        `;
        grid.appendChild(pane);
        
        // 保存滚动位置
        const paneContent = document.getElementById(`ai-view-${view.id}`);
        if (paneContent) {
            paneContent.addEventListener('scroll', function() {
                if (!aiViewerState.scrollPositions) aiViewerState.scrollPositions = {};
                aiViewerState.scrollPositions[view.id] = this.scrollTop;
            });
        }
    });
}

/**
 * 返回上一级目录
 */
function goUpDirectory() {
    if (!aiViewerState.currentDir) return;
    
    const parts = aiViewerState.currentDir.replace(/\\/g, '/').split('/');
    if (parts.length > 1) {
        parts.pop();
        const parentDir = parts.join('/') || '.';
        loadAIDirectory(parentDir);
    }
}

/**
 * 设置AI查看器的快捷键处理（屏蔽主界面快捷键）
 */
function setupAIViewerKeyboard() {
    const aiViewerSection = document.getElementById('event-ai-viewer-section');
    if (!aiViewerSection) return;
    
    // 在AI查看器区域内，拦截键盘事件
    aiViewerSection.addEventListener('keydown', (e) => {
        // 如果AI查看器未显示，不处理
        if (aiViewerSection.style.display === 'none') return;
        
        // 阻止事件冒泡到主界面
        e.stopPropagation();
        
        // 处理AI查看器内的快捷键
        const isInInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
        
        // w、s键：在文件列表中移动选择
        if (!isInInput && (e.key.toLowerCase() === 'w' || e.key.toLowerCase() === 's')) {
            e.preventDefault();
            moveAISelection(e.key.toLowerCase() === 's' ? 1 : -1);
        }
        
        // Enter键：打开选中的文件或目录
        if (!isInInput && e.key === 'Enter') {
            e.preventDefault();
            if (aiViewerState.currentFileItem) {
                if (aiViewerState.currentFileItem.isDir) {
                    loadAIDirectory(aiViewerState.currentFileItem.path);
                } else {
                    selectAIFile(aiViewerState.currentFileItem.el, aiViewerState.currentFileItem.path);
                }
            }
        }
    }, true); // 使用捕获阶段，确保先于主界面处理
}

/**
 * 移动AI文件列表选择
 */
function moveAISelection(direction) {
    if (aiViewerState.files.length === 0) return;
    
    let newIndex = aiViewerState.selectedIndex + direction;
    
    if (newIndex < 0) {
        newIndex = aiViewerState.files.length - 1;
    } else if (newIndex >= aiViewerState.files.length) {
        newIndex = 0;
    }
    
    const fileItem = aiViewerState.files[newIndex];
    if (fileItem) {
        fileItem.el.classList.add('selected');
        aiViewerState.files.forEach((f, idx) => {
            if (idx !== newIndex) {
                f.el.classList.remove('selected');
            }
        });
        
        aiViewerState.selectedIndex = newIndex;
        aiViewerState.currentFileItem = fileItem;
        
        // 滚动到可见区域
        fileItem.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.showAIViewer = showAIViewer;
    window.hideAIViewer = hideAIViewer;
    window.initAIViewer = initAIViewer;
}

