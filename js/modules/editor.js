/**
 * 编辑器模块
 * 负责文件内容加载、粘贴、复制等功能
 */

import { state, getViewById } from '../core/state.js';
import { getFile, saveFile, createFile, createFolder } from '../core/api.js';
import { getPrompt } from '../core/api.js';
import { addToHistory, initializeHistories } from '../utils/history.js';
import { processContent } from '../utils/markdownConverter.js';
import { renderHtmlWithVDOM } from '../utils/simpleVirtualDom.js';
import { isSupportedFileType, getFileFolderPath, getFileInFolderPath } from '../utils/fileUtils.js';
import { showButtonSuccessFeedback } from './viewManager.js';
import { formatPromptContent } from '../utils/promptFormatter.js';

/**
 * 轻量级加载文件内容到state（不更新UI）
 * 用于批量执行等场景，只需要加载文件内容而不更新界面
 * @param {string} basePath - 文件路径
 */
export async function loadFileContentToState(basePath) {
    const lastSeparatorIndex = Math.max(basePath.lastIndexOf('\\'), basePath.lastIndexOf('/'));
    const dir = lastSeparatorIndex >= 0 ? basePath.substring(0, lastSeparatorIndex + 1) : '';
    const fileName = lastSeparatorIndex >= 0 ? basePath.substring(lastSeparatorIndex + 1) : basePath;
    const lastDotIndex = fileName.lastIndexOf('.');
    const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
    const ext = lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1).trim() : '';
    
    console.log(`[批量执行] 加载文件内容到state: ${basePath}`);
    
    // 为每个视图加载文件内容
    for (const view of state.views) {
        const paneId = view.id;
        const targetFileName = `${baseName}${view.suffix || ''}${ext ? '.' + ext : ''}`;
        
        // 判定逻辑：只有第一个视图（suffix为空或undefined）保存在根目录，其他视图保存在文件名文件夹内
        let targetPath;
        const hasSuffix = view.suffix !== undefined && 
                          view.suffix !== null && 
                          String(view.suffix).trim() !== '';
        
        if (!hasSuffix) {
            // 第一个视图（无suffix）：保存在根目录（与文件名文件夹同级）
            // 注意：第一个视图的文件就是basePath本身
            targetPath = basePath;
        } else {
            // 其他视图（有suffix）：保存在文件名文件夹内
            targetPath = getFileInFolderPath(basePath, targetFileName);
        }
        state.panePaths[paneId] = targetPath;
        
        // 加载文件内容到 state.rawContents
        if (!isSupportedFileType(targetPath)) {
            state.rawContents[paneId] = "**不支持的文件类型**";
            console.log(`[批量执行] 视图 ${paneId}: 不支持的文件类型`);
        } else {
            try {
                const content = await getFile(targetPath);
                // 检查是否是错误响应（404或其他错误）
                if (content.trim().startsWith('{') && content.includes('"error"')) {
                    // 对于第一个视图（原始文件），如果文件不存在，应该抛出错误
                    // 对于其他视图文件，如果不存在，使用空字符串（这些文件可能还没有创建）
                    if (!hasSuffix) {
                        // 原始文件不存在，这是错误
                        console.warn(`[批量执行] 原始文件不存在: ${targetPath}`);
                        state.rawContents[paneId] = '';
                    } else {
                        // 视图文件不存在，使用空字符串
                        state.rawContents[paneId] = '';
                        console.log(`[批量执行] 视图 ${paneId}: 文件不存在，使用空内容`);
                    }
                } else {
                    state.rawContents[paneId] = content;
                    console.log(`[批量执行] 视图 ${paneId}: 成功加载文件内容，长度: ${content.length} 字符`);
                }
            } catch (error) {
                // 如果第一个视图（原始文件）读取失败，记录错误但不抛出（允许工作流继续）
                if (!hasSuffix) {
                    console.warn(`[批量执行] 读取原始文件失败: ${targetPath}`, error);
                } else {
                    console.log(`[批量执行] 视图 ${paneId}: 读取文件失败，使用空内容`, error.message);
                }
                state.rawContents[paneId] = '';
            }
        }
    }
    
    // 验证加载的内容（只检查第一个视图）
    const firstView = state.views.find(v => !v.suffix || String(v.suffix).trim() === '');
    if (firstView) {
        const firstViewContent = state.rawContents[firstView.id] || '';
        console.log(`[批量执行] 第一个视图 "${firstView.id}" 的内容预览: ${firstViewContent.substring(0, 100)}...`);
    }
}

/**
 * 加载文件视图
 */
export async function loadFileViews(basePath) {
    const lastSeparatorIndex = Math.max(basePath.lastIndexOf('\\'), basePath.lastIndexOf('/'));
    const dir = lastSeparatorIndex >= 0 ? basePath.substring(0, lastSeparatorIndex + 1) : '';
    const fileName = lastSeparatorIndex >= 0 ? basePath.substring(lastSeparatorIndex + 1) : basePath;
    const lastDotIndex = fileName.lastIndexOf('.');
    const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
    const ext = lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1).trim() : '';
    
    state.originalPath = basePath;
    // 加载文件后，标记已不是刷新后的第一次创建
    state.isFirstCreateAfterReload = false;
    initializeHistories();
    
    // 通知分离窗口文件已切换（在 state.views 确定之后调用）
    // 注意：这里 state.views 应该已经加载完成，因为 loadFileViews 是在视图配置加载后调用的
    if (typeof window !== 'undefined' && window.notifySeparatedWindowsFileChange) {
        console.log('[loadFileViews] 准备通知分离窗口文件切换:', basePath);
        window.notifySeparatedWindowsFileChange(basePath);
    } else {
        console.warn('[loadFileViews] notifySeparatedWindowsFileChange 函数未定义，可能拖拽分离功能未初始化');
    }
    
    // 重置所有视图的_ai状态和原始路径
    state.views.forEach(view => {
        state.viewAiStates[view.id] = false;
        // 同时更新状态显示元素，确保显示正确
        const statusEl = document.getElementById(`view-status-${view.id}`);
        if (statusEl) {
            statusEl.textContent = '当前是：主视图';
        }
    });
    state.originalPanePaths = {};
    
    // 检查是否有其他视图文件存在，只有存在时才创建文件夹
    let hasOtherViewFiles = false;
    const fileFolderPath = getFileFolderPath(basePath);
    try {
        const { getDirectory } = await import('../core/api.js');
        const folderData = await getDirectory(fileFolderPath);
        // 检查文件夹内是否有其他视图文件（非第一个视图的文件）
        for (const view of state.views) {
            const hasSuffix = view.suffix !== undefined && 
                              view.suffix !== null && 
                              String(view.suffix).trim() !== '';
            if (hasSuffix) {
                const targetFileName = `${baseName}${view.suffix}${ext ? '.' + ext : ''}`;
                const targetPath = getFileInFolderPath(basePath, targetFileName);
                const normalizedTargetPath = targetPath.replace(/\\/g, '/');
                // 检查文件夹内是否有这个文件
                const fileExists = folderData.files.some(file => {
                    const filePath = file.path.replace(/\\/g, '/');
                    return filePath === normalizedTargetPath;
                });
                if (fileExists) {
                    hasOtherViewFiles = true;
                    break;
                }
            }
        }
    } catch (err) {
        // 文件夹不存在或无法访问，说明没有其他视图文件
        hasOtherViewFiles = false;
    }
    
    // 只有在有其他视图文件时才创建文件夹
    if (hasOtherViewFiles) {
        try {
            await createFolder(fileFolderPath);
        } catch (err) {
            // 文件夹可能已存在，忽略错误
        }
    }
    
    for (const view of state.views) {
        const paneId = view.id;
        const targetFileName = `${baseName}${view.suffix || ''}${ext ? '.' + ext : ''}`;
        
        // 判定逻辑：只有第一个视图（suffix为空或undefined）保存在根目录，其他视图保存在文件名文件夹内
        let targetPath;
        // 检查suffix是否存在且不为空字符串
        // 使用更严格的判断：suffix必须存在、不为null、不为undefined，且trim后不为空
        const hasSuffix = view.suffix !== undefined && 
                          view.suffix !== null && 
                          String(view.suffix).trim() !== '';
        
        if (!hasSuffix) {
            // 第一个视图（无suffix）：保存在根目录（与文件名文件夹同级）
            targetPath = `${dir}${targetFileName}`;
        } else {
            // 其他视图（有suffix）：保存在文件名文件夹内
            targetPath = getFileInFolderPath(basePath, targetFileName);
        }
        state.panePaths[paneId] = targetPath;
        // 保存原始路径
        state.originalPanePaths[paneId] = targetPath;
        
        const titleEl = document.getElementById(`title-${paneId}`);
        if (titleEl) {
            // 获取视图的suffix（从视图配置中动态获取）
            const viewSuffix = (view.suffix !== undefined && view.suffix !== null && String(view.suffix).trim() !== '') 
                ? view.suffix 
                : '';
            // 拼接文件名用于显示（baseName + suffix，不包含扩展名）
            const displayFileName = baseName + viewSuffix;
            titleEl.textContent = view.titleTemplate.replace('{filename}', displayFileName);
        }
        
        const viewEl = document.getElementById(`view-${paneId}`);
        if (!viewEl) continue;
        
        // 恢复滚动位置
        if (state.scrollPositions[paneId] !== undefined) {
            viewEl.scrollTop = state.scrollPositions[paneId];
        } else {
            viewEl.scrollTop = 0;
        }
        
        if (!isSupportedFileType(targetPath)) {
            renderHtmlWithVDOM(
                viewEl,
                `<div style="color:var(--text-muted); padding:20px; font-style:italic; font-size:13px;">不支持的文件类型（仅支持 .txt 和 .md）</div>`
            );
            state.rawContents[paneId] = "**不支持的文件类型**";
        } else {
            try {
                const content = await getFile(targetPath);
                if (content.trim().startsWith('{') && content.includes('"error"')) {
                    state.rawContents[paneId] = '';
                    renderHtmlWithVDOM(
                        viewEl,
                        `<div style="color:var(--text-muted); padding:20px; font-style:italic; font-size:13px;">文件未找到 (Ctrl+V创建)</div>`
                    );
                } else {
                    state.rawContents[paneId] = content;
                    // 加载文件时不添加历史记录，只有粘贴操作才添加历史
                    const html = processContent(marked.parse(content));
                    const safeHtml = DOMPurify.sanitize(html);
                    renderHtmlWithVDOM(viewEl, safeHtml);
                }
            } catch (error) {
                state.rawContents[paneId] = '';
                renderHtmlWithVDOM(
                    viewEl,
                    `<div style="color:var(--text-muted); padding:20px; font-style:italic; font-size:13px;">文件未找到 (Ctrl+V创建)</div>`
                );
            }
            
            // 增强表格和跳转链接
            if (window.enhanceTables) window.enhanceTables();
            if (window.attachJumpLinkListeners) window.attachJumpLinkListeners(viewEl);
        }
    }
    
    // 自动同步上下文到服务器（供外部项目使用）
    if (window.getAllViewsContextWithSync) {
        setTimeout(async () => {
            try {
                await window.getAllViewsContextWithSync();
            } catch (err) {
                console.warn('自动同步上下文失败:', err);
            }
        }, 500); // 延迟500ms确保所有视图都已加载完成
    }
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
export async function handlePaste() {
    if (!state.originalPath) {
        alert('请先选择左侧文件');
        return;
    }
    
    const selectedRadio = document.querySelector('input[name="paste-target"]:checked');
    if (!selectedRadio) {
        alert('请先选择粘贴目标视图');
        return;
    }
    
    const selectedPaneId = selectedRadio.value;
    const targetPath = state.panePaths[selectedPaneId];
    
    if (!targetPath) {
        alert('无法确定目标文件路径');
        return;
    }
    
    if (!isSupportedFileType(targetPath)) {
        alert('不支持的文件类型');
        return;
    }
    
    // 检查是否是页面刷新后的第一次创建操作
    if (state.isFirstCreateAfterReload) {
        alert('页面刷新后，请先选择文件后再进行粘贴操作');
        state.isFirstCreateAfterReload = false; // 标记已处理
        return;
    }
    
    // 检查目录一致性：如果原始文件存在，确保目标路径的目录与原始文件的目录一致
    const originalPathNormalized = state.originalPath.replace(/\\/g, '/');
    const originalDir = originalPathNormalized.substring(0, originalPathNormalized.lastIndexOf('/') + 1);
    const targetPathNormalized = targetPath.replace(/\\/g, '/');
    const targetDir = targetPathNormalized.substring(0, targetPathNormalized.lastIndexOf('/') + 1);
    
    if (originalDir && targetDir !== originalDir) {
        alert(`无法创建文件：目标目录与原始文件目录不一致。\n原始目录: ${originalDir}\n目标目录: ${targetDir}`);
        return;
    }
    
    // 检查并请求剪贴板权限
    const hasPermission = await checkAndRequestClipboardPermission();
    if (!hasPermission) {
        return;
    }
    
    try {
        const content = await navigator.clipboard.readText();
        
        // 检查内容是否为空，如果为空则不创建
        if (!content || content.trim() === '') {
            alert('剪贴板内容为空，无法创建文件');
            return;
        }
        addToHistory(selectedPaneId, state.rawContents[selectedPaneId] || '');
        state.rawContents[selectedPaneId] = content;
        
        const html = processContent(marked.parse(content));
        const viewEl = document.getElementById(`view-${selectedPaneId}`);
        if (viewEl) {
            const safeHtml = DOMPurify.sanitize(html);
            renderHtmlWithVDOM(viewEl, safeHtml);
            if (window.enhanceTables) window.enhanceTables();
            if (window.attachJumpLinkListeners) window.attachJumpLinkListeners(viewEl);
        }
        
        await saveFile(targetPath, content);
        
        // 显示反馈效果
        if (viewEl) {
            viewEl.style.opacity = 0.5;
            setTimeout(() => viewEl.style.opacity = 1, 200);
        }
        
        // 显示成功反馈效果（按钮上显示✅）
        showButtonSuccessFeedback(`.view-paste-btn[data-view-id="${selectedPaneId}"]`);
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
export async function copyContent() {
    if (!state.originalPath) return;
    
    let text = '';
    
    // 添加提示词
    if (state.selectedPrompt && state.selectedPrompt.content) {
        text += formatPromptContent(state.selectedPrompt.content, '全局提示词');
    }
    
    // 添加所有视图内容
    state.views.forEach(view => {
        const content = state.rawContents[view.id] || '';
        const fileName = state.originalPath.split(/[/\\]/).pop();
        text += `${view.titleTemplate.replace('{filename}', fileName)}\n\n${content}\n\n\n`;
    });
    
    try {
        await navigator.clipboard.writeText(text);
        const btn = document.getElementById('btn-copy');
        if (btn) {
            const old = btn.innerText;
            btn.innerText = "✅ OK";
            setTimeout(() => btn.innerText = old, 1500);
        }
    } catch (error) {
        console.error('复制失败:', error);
        alert('复制失败: ' + error.message);
    }
}

/**
 * 复制视图内容
 */
export async function copyViewContent(viewId) {
    if (!state.originalPath) return;
    
    let text = '';
    
    // 添加提示词
    if (state.selectedPrompt && state.selectedPrompt.content) {
        text += formatPromptContent(state.selectedPrompt.content, '全局提示词');
    }
    
    // 添加特定视图的内容，使用Map索引直接查找，O(1)复杂度
    const view = getViewById(viewId);
    if (view) {
        const content = state.rawContents[view.id] || '';
        const fileName = state.originalPath.split(/[/\\]/).pop();
        text += `${view.titleTemplate.replace('{filename}', fileName)}\n\n${content}\n\n\n`;
    }
    
    try {
        await navigator.clipboard.writeText(text);
        
        // 显示反馈效果（使用统一的反馈管理）
        showButtonSuccessFeedback(`.view-copy-btn[data-view-id="${viewId}"]`);
    } catch (error) {
        console.error('复制失败:', error);
        alert('复制失败: ' + error.message);
    }
}

/**
 * 绑定跳转链接监听器
 */
export function attachJumpLinkListeners(container) {
    const jumpLinks = container.querySelectorAll('.jump-link');
    jumpLinks.forEach(link => {
        link.removeEventListener('click', handleJumpClick);
        link.addEventListener('click', handleJumpClick);
    });
}

/**
 * 处理跳转链接点击
 */
function handleJumpClick(e) {
    e.preventDefault();
    e.stopPropagation();

    const fullscreenModal = document.getElementById('fullscreen-modal');
    if (fullscreenModal && fullscreenModal.style.display === 'flex') {
        if (window.closeFullscreen) {
            window.closeFullscreen();
        }
    }

    const jumpTarget = this.getAttribute('data-jump');
    if (jumpTarget && selectFileByPath) {
        selectFileByPath(jumpTarget);
    }
}

/**
 * 处理跳转（兼容旧代码）
 */
export async function handleJump(fileName) {
    if (window.closeFullscreen) {
        window.closeFullscreen();
    }
    await selectFileByPath(fileName);
}

/**
 * 通过路径选择文件
 */
export async function selectFileByPath(filePath) {
    if (window.closeFullscreen) window.closeFullscreen();
    
    if (state.originalPath) {
        if (!state.fileJumpStack) state.fileJumpStack = [];
        state.fileJumpStack.push(state.originalPath);
    }
    
    state.currentContext = 'file';
    
    // 解析文件路径，获取文件名（不包含路径，只在当前目录查找）
    const lastSeparatorIndex = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
    let fileName = lastSeparatorIndex >= 0 ? filePath.substring(lastSeparatorIndex + 1) : filePath;
    
    // 构建当前目录下的完整路径
    const currentDirPath = state.currentDir.replace(/\\/g, '/');
    const normalizedCurrentDir = currentDirPath.endsWith('/') ? currentDirPath : currentDirPath + '/';
    
    // 检查文件名是否有扩展名
    const hasExtension = fileName.includes('.');
    let fullFilePath = normalizedCurrentDir + fileName;
    
    // 如果文件名没有扩展名，先尝试查找 .md 文件，如果找不到再尝试 .txt
    let tryMd = false;
    let tryTxt = false;
    if (!hasExtension) {
        tryMd = true;
        fullFilePath = normalizedCurrentDir + fileName + '.md';
    }
    
    // 只在当前目录中查找，不切换目录
    // 重新加载当前目录以确保文件列表是最新的
    if (window.loadDir) {
        await window.loadDir(state.currentDir);
        await new Promise(resolve => setTimeout(resolve, 150));
    }
    
    // 尝试查找文件的函数
    const findFile = async (searchPath) => {
        const normalizedPath = searchPath.replace(/\\/g, '/');
        let foundItem = null;
        let foundInfo = null;
        
        for (let i = 0; i < 15; i++) {
            // 先从 state.files 中查找
            foundInfo = state.files.find(f => {
                const fPath = f.path ? f.path.replace(/\\/g, '/') : '';
                return fPath === normalizedPath && !f.isDir;
            });
            
            if (foundInfo && foundInfo.el) {
                foundItem = foundInfo.el;
                break;
            }
            
            // 从DOM中查找
            const domItem = Array.from(document.querySelectorAll('.file-item.type-file')).find(item => {
                const itemPath = item.dataset.path ? item.dataset.path.replace(/\\/g, '/') : '';
                return itemPath === normalizedPath;
            });
            
            if (domItem) {
                foundInfo = state.files.find(f => f.el === domItem);
                if (foundInfo) {
                    foundItem = domItem;
                    break;
                } else {
                    const itemPath = domItem.dataset.path || normalizedPath;
                    foundInfo = { el: domItem, path: itemPath, isDir: false };
                    foundItem = domItem;
                    break;
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, 100 + i * 20));
        }
        
        return { item: foundItem, info: foundInfo };
    };
    
    // 尝试查找文件
    let targetFileItem = null;
    let fileInfo = null;
    let normalizedFilePath = fullFilePath.replace(/\\/g, '/');
    
    const result = await findFile(normalizedFilePath);
    targetFileItem = result.item;
    fileInfo = result.info;
    
    // 如果没找到且文件名没有扩展名，尝试查找 .txt 文件
    if (!targetFileItem && tryMd) {
        const txtPath = normalizedCurrentDir + fileName + '.txt';
        const txtResult = await findFile(txtPath);
        if (txtResult.item) {
            targetFileItem = txtResult.item;
            fileInfo = txtResult.info;
            normalizedFilePath = txtPath.replace(/\\/g, '/');
            tryTxt = true;
        }
    }
    
    if (targetFileItem && fileInfo) {
        // 确保文件被选中和高亮，isJump=true 表示这是跳转操作，需要滚动到可见区域顶部
        // 先等待一下，确保文件列表完全渲染
        await new Promise(resolve => setTimeout(resolve, 100));
        
        if (window.selectFile) {
            await window.selectFile(targetFileItem, fileInfo.path, true, true);
        }
    } else {
        // 如果找不到文件，需要检查多个条件
        // 1. 检查是否是页面刷新后的第一次创建操作
        if (state.isFirstCreateAfterReload) {
            console.log('[selectFileByPath] 页面刷新后的第一次创建操作，直接屏蔽');
            state.isFirstCreateAfterReload = false; // 标记已处理，后续操作可以正常进行
            return; // 不创建文件，也不显示
        }
        
        // 2. 检查目录是否一致
        // 获取原始文件的目录
        let originalDir = '';
        if (state.originalPath) {
            const originalPathNormalized = state.originalPath.replace(/\\/g, '/');
            const lastSeparatorIndex = Math.max(originalPathNormalized.lastIndexOf('/'), originalPathNormalized.lastIndexOf('\\'));
            originalDir = lastSeparatorIndex >= 0 ? originalPathNormalized.substring(0, lastSeparatorIndex + 1) : '';
        }
        
        // 比对目录：如果原始文件存在且目录不一致，不创建文件，也不显示
        if (state.originalPath && originalDir && normalizedCurrentDir !== originalDir) {
            console.log(`[selectFileByPath] 目录不一致，不创建文件。原始目录: ${originalDir}, 当前目录: ${normalizedCurrentDir}`);
            // 不创建文件，也不显示，直接返回
            return;
        }
        
        // 3. 如果找不到文件，创建空白文件
        console.log('[selectFileByPath] 文件未找到，创建新文件');
        // 创建文件并打开
        try {
            const { createFile } = await import('../core/api.js');
            await createFile(normalizedFilePath);
            // 等待文件创建完成
            await new Promise(resolve => setTimeout(resolve, 200));
            // 重新加载目录
            if (window.loadDir) {
                await window.loadDir(state.currentDir);
                await new Promise(resolve => setTimeout(resolve, 150));
            }
            // 再次查找文件
            const retryResult = await findFile(normalizedFilePath);
            if (retryResult.item && retryResult.info) {
                if (window.selectFile) {
                    await window.selectFile(retryResult.item, retryResult.info.path, true, true);
                }
            }
        } catch (error) {
            console.error('[selectFileByPath] 创建文件失败:', error);
        }
    }
}

/**
 * 获取当前应该使用的文件路径（批量执行时优先使用批量处理的路径）
 * @returns {string|null} 文件路径
 */
function getCurrentFilePath() {
    // 批量执行时，优先使用批量处理的路径，完全忽略主界面的路径
    // 这是关键：即使主界面修改了 state.originalPath，批量执行也会使用正确的路径
    if (state.workflowExecutionState?.batchFilePath) {
        const batchPath = state.workflowExecutionState.batchFilePath;
        // 调试日志：如果发现 state.originalPath 与 batchFilePath 不同，记录警告
        if (state.originalPath && state.originalPath !== batchPath) {
            console.log(`[getCurrentFilePath] 批量执行模式：使用批量处理路径 ${batchPath}，忽略主界面路径 ${state.originalPath}`);
        }
        return batchPath;
    }
    // 非批量执行时，使用主界面的路径
    return state.originalPath;
}

/**
 * 读取当前视图内容
 * @param {string} viewId - 视图ID
 * @returns {Promise<{viewId: string, prompt: string|null, content: string, openaiConfig: object|null}>}
 */
export async function readCurrentView(viewId) {
    const currentFilePath = getCurrentFilePath();
    if (!currentFilePath) {
        throw new Error('请先选择文件');
    }
    
    // 使用Map索引直接查找，O(1)复杂度
    const view = getViewById(viewId);
    if (!view) {
        throw new Error(`视图 ${viewId} 不存在`);
    }
    
    // 获取视图内容
    const content = state.rawContents[viewId] || '';
    
    // 获取视图提示词
    let promptContent = null;
    let enableWorkflowControl = false; // 默认关闭
    if (view.promptId) {
        try {
            const prompt = await getPrompt(view.promptId);
            promptContent = prompt.content;
            // 如果提示词配置中有enableWorkflowControl字段，使用它；否则默认关闭
            enableWorkflowControl = prompt.enableWorkflowControl !== undefined ? prompt.enableWorkflowControl : false;
        } catch (err) {
            console.error(`获取提示词失败: ${view.promptId}`, err);
        }
    }
    
    return {
        viewId: viewId,
        prompt: promptContent,
        enableWorkflowControl: enableWorkflowControl,
        content: content,
        openaiConfig: view.openaiConfig || null
    };
}

// 写入队列系统（用于非阻塞写入）
const writeQueues = new Map();

/**
 * 处理写入队列（非阻塞）
 * 关键修复：每个队列独立处理，不同文件的队列可以并发执行
 * 注意：同一队列内的写入任务仍然串行执行（因为写入同一个文件），但不同队列可以并发
 */
async function processWriteQueue(queueKey) {
    const queue = writeQueues.get(queueKey);
    if (!queue || queue.isWriting) {
        return;
    }
    
    queue.isWriting = true;
    
    // 关键修复：同一队列内的写入任务串行执行（因为写入同一个文件）
    // 但不同队列（不同文件）的写入可以并发执行
    while (queue.queue.length > 0) {
        const { viewId, content, options, resolve, reject } = queue.queue.shift();
        
        try {
            const result = await _writeCurrentViewInternal(viewId, content, options);
            if (resolve) resolve(result);
        } catch (err) {
            console.error(`写入文件失败 (${queueKey}):`, err);
            if (reject) reject(err);
        }
        
        // 短暂延迟，避免过于频繁的写入
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    queue.isWriting = false;
}

/**
 * 写入当前视图内容（保存AI消息，非阻塞，使用队列）
 * @param {string} viewId - 视图ID
 * @param {string} content - 要保存的内容
 * @param {object} options - 可选参数 {eventTimestamp, eventName, workflowName, stepIndex}
 * @returns {Promise<string>} 保存的文件路径
 */
export async function writeCurrentView(viewId, content, options = {}) {
    // 关键修复：批量执行时，使用文件路径作为队列键的一部分，确保不同文件的写入可以并发
    // 队列键格式：write_${viewId}_${filePath}，这样不同文件的相同viewId可以并发写入
    const targetFilePath = options.batchFilePath || getCurrentFilePath();
    const queueKey = targetFilePath 
        ? `write_${viewId}_${targetFilePath.replace(/[^a-zA-Z0-9]/g, '_')}` 
        : `write_${viewId}`;
    
    if (!writeQueues.has(queueKey)) {
        writeQueues.set(queueKey, { queue: [], isWriting: false });
    }
    
    const queue = writeQueues.get(queueKey);
    
    // 返回 Promise，但不阻塞
    return new Promise((resolve, reject) => {
        queue.queue.push({ viewId, content, options, resolve, reject });
        
        if (!queue.isWriting) {
            // 关键修复：立即启动队列处理，不等待，确保并发写入
            processWriteQueue(queueKey).catch(err => {
                console.error('写入队列处理失败:', err);
            });
        }
    });
}

/**
 * 内部写入函数（实际执行写入）
 */
async function _writeCurrentViewInternal(viewId, content, options = {}) {
    // 批量执行时，优先使用批量处理的路径，完全忽略主界面的路径
    // 如果 options 中有 batchFilePath，也优先使用（用于传递参数）
    const targetFilePath = options.batchFilePath || 
                          getCurrentFilePath();
    
    if (!targetFilePath) {
        throw new Error('请先选择文件');
    }
    
    // 使用Map索引直接查找，O(1)复杂度
    const view = getViewById(viewId);
    if (!view) {
        throw new Error(`视图 ${viewId} 不存在`);
    }
    
    // AI消息文件保存在文件名文件夹内
    const lastSeparatorIndex = Math.max(targetFilePath.lastIndexOf('\\'), targetFilePath.lastIndexOf('/'));
    const fileName = lastSeparatorIndex >= 0 ? targetFilePath.substring(lastSeparatorIndex + 1) : targetFilePath;
    const lastDotIndex = fileName.lastIndexOf('.');
    const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
    const ext = lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1).trim() : '';
    
    // AI消息文件：文件名 + AgentID + _AI.md，保存在文件名文件夹内
    const aiFileName = `${baseName}_${viewId}_AI.${ext || 'md'}`;
    const aiFilePath = getFileInFolderPath(targetFilePath, aiFileName);
    
    // 调试日志：记录使用的文件路径
    if (state.workflowExecutionState?.batchFilePath) {
        console.log(`[writeCurrentView] 批量执行模式，使用文件路径: ${targetFilePath}`);
    }
    
    // 关键修复：工作流执行时总是使用追加模式
    // 判断是否是事件执行模式（需要追加写入）
    // 只要有 workflowExecutionState 或者有 eventTimestamp 和 stepIndex，就使用追加模式
    const hasWorkflowState = state.workflowExecutionState && state.workflowExecutionState.workflowName;
    const isEventExecution = (options.eventTimestamp && options.stepIndex !== undefined) || hasWorkflowState;
    
    try {
        if (isEventExecution) {
            // 事件执行模式：使用追加格式
            // 格式：时间戳+工作流名+事件名+回车+步骤数+步骤名+回车+内容
            // 关键修复：从 options 或 state 中获取事件信息
            const timestamp = options.eventTimestamp || state.workflowExecutionState?.eventTimestamp;
            const workflowName = options.workflowName || state.workflowExecutionState?.workflowName || '未知工作流';
            const eventName = options.eventName || state.workflowExecutionState?.eventName || '未知事件';
            // 关键修复：如果没有 stepIndex，尝试从 workflowExecutionState 中获取，或者使用当前步骤索引
            const stepIndex = options.stepIndex !== undefined ? options.stepIndex : 
                                (state.workflowExecutionState?.currentStepIndex || 'N');
            
            // 读取现有文件内容
            let existingContent = '';
            let isAppend = false;
            try {
                const { getFile } = await import('../core/api.js');
                const fileContent = await getFile(aiFilePath);
                // 检查是否是错误响应（文件不存在）
                if (fileContent.trim().startsWith('{') && fileContent.includes('"error"')) {
                    // 文件不存在，创建新文件（第一次执行）
                    existingContent = '';
                    isAppend = false;
                } else {
                    // 文件已存在，使用追加模式（后续执行）
                    existingContent = fileContent;
                    isAppend = true;
                }
            } catch (err) {
                // 文件不存在或读取失败，创建新文件（第一次执行）
                existingContent = '';
                isAppend = false;
            }
            
            // 构建追加内容
            // 追加格式：工作流：工作流名，事件：事件名，步骤：步骤数+步骤名（更易读的格式）
            let finalContent = '';
            const stepDisplay = `${stepIndex}+${viewId}`;
            
            // 关键修复：只有当前步骤是工作流节点时，才在文件头部添加父工作流信息
            // 不能因为工作流中有工作流节点，就给所有步骤都添加工作流节点信息
            let headerPrefix = '';
            const execState = state.workflowExecutionState;
            // 检查当前viewId是否是工作流节点（通过检查options中的标识）
            // 只有真正是工作流节点时才添加父工作流信息
            const isCurrentStepWorkflowNode = options?.isWorkflowNode || false;
            if (isCurrentStepWorkflowNode && execState && execState.parentWorkflowName) {
                // 工作流节点：添加父工作流信息，表明这是工作流节点执行的结果
                headerPrefix = `工作流节点：${execState.parentWorkflowViewId || execState.parentWorkflowName}\n父工作流：${execState.parentWorkflowName}\n`;
            }
            
            if (isAppend) {
                // 文件已存在，追加新步骤
                const stepHeader = `\n\n${headerPrefix}工作流：${workflowName}\n事件：${eventName}\n步骤：${stepDisplay}\n`;
                // 提取content中的实际内容（去掉时间戳和视图ID头部）
                const contentLines = content.split('\n');
                // 跳过前3行（时间戳、视图ID、空行）
                const actualContent = contentLines.length > 3 ? contentLines.slice(3).join('\n') : content;
                finalContent = existingContent + stepHeader + actualContent;
            } else {
                // 文件不存在，创建新文件（使用追加格式）
                const header = `${headerPrefix}工作流：${workflowName}\n事件：${eventName}\n步骤：${stepDisplay}\n`;
                // 提取content中的实际内容
                const contentLines = content.split('\n');
                const actualContent = contentLines.length > 3 ? contentLines.slice(3).join('\n') : content;
                finalContent = header + actualContent;
            }
            
            await saveFile(aiFilePath, finalContent);
        } else {
            // 非事件执行模式：直接覆盖写入（保持原有逻辑）
            await saveFile(aiFilePath, content);
        }
        return aiFilePath;
    } catch (error) {
        console.error('保存AI消息失败:', error);
        throw new Error('保存AI消息失败: ' + error.message);
    }
}

/**
 * 写入事件执行步骤文件（时间戳+文件名+视图名格式）
 * @param {string} viewId - 视图ID
 * @param {string} timestamp - 时间戳（ISO格式）
 * @param {number} stepIndex - 步骤索引（从1开始）
 * @param {string} content - 要保存的内容
 * @returns {Promise<string>} 保存的文件路径
 */
export async function writeEventStepFile(viewId, timestamp, stepIndex, content) {
    // 批量执行时，优先使用批量处理的路径，完全忽略主界面的路径
    const targetFilePath = getCurrentFilePath();
    
    if (!targetFilePath) {
        throw new Error('请先选择文件');
    }
    
    // 使用Map索引直接查找，O(1)复杂度
    const view = getViewById(viewId);
    if (!view) {
        throw new Error(`视图 ${viewId} 不存在`);
    }
    
    // 解析原文件路径
    const lastSeparatorIndex = Math.max(targetFilePath.lastIndexOf('\\'), targetFilePath.lastIndexOf('/'));
    const fileName = lastSeparatorIndex >= 0 ? targetFilePath.substring(lastSeparatorIndex + 1) : targetFilePath;
    const lastDotIndex = fileName.lastIndexOf('.');
    const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
    const ext = lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1).trim() : '';
    
    // 格式化时间戳为文件名友好格式（去掉特殊字符）
    const timestampStr = timestamp.replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
    
    // 步骤文件：时间戳_文件名_视图名_步骤N.扩展名，保存在文件名文件夹内
    const stepFileName = `${timestampStr}_${baseName}_${viewId}_步骤${stepIndex}.${ext || 'md'}`;
    const stepFilePath = getFileInFolderPath(targetFilePath, stepFileName);
    
    // 调试日志：记录使用的文件路径
    if (state.workflowExecutionState?.batchFilePath) {
        console.log(`[writeEventStepFile] 批量执行模式，使用文件路径: ${targetFilePath}`);
    }
    
    try {
        await saveFile(stepFilePath, content);
        return stepFilePath;
    } catch (error) {
        console.error('保存步骤文件失败:', error);
        throw new Error('保存步骤文件失败: ' + error.message);
    }
}

/**
 * 创建流式文件写入器
 * @param {string} filePath - 文件路径
 * @param {string} viewId - 视图ID（可选）
 * @param {boolean} appendMode - 是否为追加模式（默认false）
 * @param {number} stepIndex - 步骤索引（追加模式时需要，用于分隔不同步骤的内容）
 * @param {string} eventName - 事件名称（追加模式时需要）
 * @param {string} eventTimestamp - 事件时间戳（追加模式时需要）
 * @param {string} workflowName - 工作流名称（追加模式时需要）
 * @param {object} nestedContext - 嵌套工作流上下文信息（可选）{isNestedWorkflow: boolean, parentWorkflowName: string, parentWorkflowViewId: string}
 * @returns {Promise<{write: function, close: function}>} 写入器对象
 */
export function createStreamFileWriter(filePath, viewId = 'unknown', appendMode = false, stepIndex = null, eventName = null, eventTimestamp = null, workflowName = null, nestedContext = null) {
    // 注意：这个函数现在是同步的，不返回Promise，立即返回写入器对象
    const timestamp = eventTimestamp || new Date().toISOString();
    
    let buffer = '';
    let lastWriteTime = Date.now();
    const writeInterval = 500; // 每500ms写入一次
    let flushTimer = null; // 延迟flush的timer
    let lastFlushContent = null; // 上次flush的内容，用于检测是否有新内容
    let isFlushing = false; // 标记是否正在flush，防止并发flush
    let isInitialized = false; // 标记是否已初始化
    
    // 初始化文件写入
    const initializeFile = async () => {
        if (isInitialized) return;
        
        // 获取工作流名（优先使用传入的参数，否则从state中获取）
        const finalWorkflowName = workflowName || (typeof window !== 'undefined' && window.state?.workflowExecutionState?.workflowName) || '未知工作流';
        
        if (appendMode || eventName) {
            // 追加模式或事件执行模式：使用追加格式
            // 追加格式：工作流：工作流名，事件：事件名，步骤：步骤数+步骤名（更易读的格式）
            const stepDisplay = stepIndex ? `${stepIndex}+${viewId}` : viewId;
            
            // 关键修复：只有当前步骤是工作流节点时，才在文件头部添加父工作流信息
            // 不能因为工作流中有工作流节点，就给所有步骤都添加工作流节点信息
            let headerPrefix = '';
            // 检查nestedContext中是否有isWorkflowNode标识，只有真正是工作流节点时才添加
            const isCurrentStepWorkflowNode = nestedContext?.isWorkflowNode || false;
            if (isCurrentStepWorkflowNode && nestedContext && nestedContext.isNestedWorkflow && nestedContext.parentWorkflowName) {
                // 嵌套工作流：添加父工作流信息，表明这是工作流节点执行的结果
                headerPrefix = `工作流节点：${nestedContext.parentWorkflowViewId || nestedContext.parentWorkflowName}\n父工作流：${nestedContext.parentWorkflowName}\n`;
            }
            
            try {
                const { getFile, createFile } = await import('../core/api.js');
                let existingContent = '';
                let fileExists = false;
                try {
                    existingContent = await getFile(filePath);
                    // 检查是否是错误响应（只检查特定的错误格式）
                    if (existingContent.trim().startsWith('{"error": "File not found"') && existingContent.includes('"path"')) {
                        // 文件不存在，使用追加格式创建新文件（第一次创建也用追加格式）
                        fileExists = false;
                    } else {
                        // 文件已存在
                        fileExists = true;
                    }
                } catch (err) {
                    // 文件不存在或读取失败
                    fileExists = false;
                }
                
                // 格式化时间戳为中文格式：某某年某某月某某日某某小时某某分
                const formatTimestampChinese = (timestamp) => {
                    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
                    const year = date.getFullYear();
                    const month = date.getMonth() + 1;
                    const day = date.getDate();
                    const hours = date.getHours();
                    const minutes = date.getMinutes();
                    return `${year}年${month}月${day}日${hours}小时${minutes}分`;
                };
                const formattedTimestamp = formatTimestampChinese(timestamp);
                
                // 根据文件是否存在，设置buffer
                if (fileExists) {
                    // 文件已存在，追加新步骤的头部
                    const stepHeader = `\n\n${headerPrefix}工作流：${finalWorkflowName}\n事件：${eventName || '未知事件'}\n步骤：${stepDisplay}\n${formattedTimestamp}\n`;
                    buffer = existingContent + stepHeader;
                    isInitialized = true;
                } else {
                    // 文件不存在，创建新文件（第一次执行，使用追加格式）
                    const header = `${headerPrefix}工作流：${finalWorkflowName}\n事件：${eventName || '未知事件'}\n步骤：${stepDisplay}\n${formattedTimestamp}\n`;
                    buffer = header;
                    isInitialized = true;
                }
            } catch (err) {
                // 文件不存在或读取失败，创建新文件（第一次执行）
                const formatTimestampChinese = (timestamp) => {
                    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
                    const year = date.getFullYear();
                    const month = date.getMonth() + 1;
                    const day = date.getDate();
                    const hours = date.getHours();
                    const minutes = date.getMinutes();
                    return `${year}年${month}月${day}日${hours}小时${minutes}分`;
                };
                const formattedTimestamp = formatTimestampChinese(timestamp);
                const header = `${headerPrefix}工作流：${finalWorkflowName}\n事件：${eventName || '未知事件'}\n步骤：${stepDisplay}\n${formattedTimestamp}\n`;
                buffer = header;
                isInitialized = true;
            }
        } else {
            // 新文件模式：写入头部信息（非追加模式，保持原有格式）
            const header = `时间戳: ${timestamp}\n视图ID: ${viewId}\n\n`;
            // 关键修复：确保buffer只包含正确的头部，不包含错误JSON
            buffer = header;
            isInitialized = true;
            
            // 初始化文件写入（完全异步，不阻塞，使用fetch直接发送）
            // 关键修复：立即创建文件，避免后续写入错误信息
            fetch('/api/save-file', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ path: filePath, content: header })
            }).catch(err => {
                console.error(`初始化文件写入失败 (${viewId}):`, err);
            });
        }
    };
    
    // 异步初始化（不阻塞）
    initializeFile();
    
        const flush = () => {
        // 如果正在flush，跳过（避免同一个文件的并发flush）
        // 注意：不同文件的flush可以并发，只有同一个文件的flush会串行
        if (isFlushing) {
            return;
        }
        
        // 确保已初始化（异步，不阻塞）
        if (!isInitialized) {
            initializeFile().then(() => {
                // 初始化完成后，继续flush
                flush();
            }).catch(err => {
                console.error(`初始化文件失败 (${viewId}):`, err);
            });
            return;
        }
        
        
        // 清除定时器
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        
        // 检查是否有新内容需要写入
        if (buffer === lastFlushContent) {
            return; // 没有新内容，不需要写入
        }
        
        const contentToWrite = buffer;
        // 关键修复：检查内容是否是错误响应，如果是则跳过写入
        // 只检查特定的错误格式：{"error": "File not found", "path": "..."}
        if (contentToWrite.trim().startsWith('{"error": "File not found"') && contentToWrite.includes('"path"')) {
            // 内容是错误响应，不写入，重置标志并返回
            isFlushing = false;
            console.warn(`跳过写入错误响应 (${viewId}):`, contentToWrite.substring(0, 100));
            return;
        }
        
        lastFlushContent = contentToWrite;
        isFlushing = true;
        
        // 异步写入，完全不阻塞，使用fire-and-forget模式
        // 多个步骤的文件写入可以真正并行执行（不同文件可以并发）
        // 使用 fetch 直接发送请求，不等待响应
        // 注意：/api/save-file 会自动创建文件（如果不存在）
        fetch('/api/save-file', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ path: filePath, content: contentToWrite })
        }).then(response => {
            if (!response.ok) {
                throw new Error(`Failed to save file: ${response.status} ${response.statusText}`);
            }
            return response.json();
        }).catch(err => {
            console.error(`流式写入失败 (${viewId}):`, err);
        }).finally(() => {
            // 写入完成后，重置isFlushing标志
            isFlushing = false;
            
            // 如果buffer在flush期间有更新，需要再次flush
            if (buffer !== contentToWrite) {
                // 使用微任务延迟执行，避免递归调用
                Promise.resolve().then(() => {
                    flush();
                });
            }
        });
    };
    
    return {
        write: (chunk) => {
            // 关键修复：检查chunk是否是错误JSON，如果是则跳过
            // 只检查特定的错误格式：{"error": "File not found", "path": "..."}
            if (chunk && typeof chunk === 'string' && chunk.trim().startsWith('{"error": "File not found"') && chunk.includes('"path"')) {
                console.warn(`跳过写入错误响应chunk (${viewId}):`, chunk.substring(0, 100));
                return; // 不写入错误JSON
            }
            
            // 同步更新buffer，不等待
            buffer += chunk;
            const now = Date.now();
            
            // 定期刷新到文件（使用防抖机制）
            if (now - lastWriteTime >= writeInterval) {
                lastWriteTime = now;
                // 立即flush（异步执行，不阻塞）
                flush();
            } else {
                // 延迟flush，使用防抖机制，避免过于频繁的写入
                if (flushTimer) {
                    clearTimeout(flushTimer);
                }
                const delay = writeInterval - (now - lastWriteTime);
                flushTimer = setTimeout(() => {
                    lastWriteTime = Date.now();
                    flush();
                }, delay);
            }
        },
        close: async () => {
            // 清除定时器
            if (flushTimer) {
                clearTimeout(flushTimer);
                flushTimer = null;
            }
            
            // 关键修复：不等待当前flush完成，直接写入最终内容
            // 这样可以确保多个步骤的文件写入真正并发，不会串行等待
            // 如果正在flush，让它继续，我们直接写入最终内容（覆盖写入）
            if (buffer !== lastFlushContent) {
                const contentToWrite = buffer;
                // 关键修复：检查内容是否是错误响应，如果是则跳过写入
                // 只检查特定的错误格式：{"error": "File not found", "path": "..."}
                if (contentToWrite.trim().startsWith('{"error": "File not found"') && contentToWrite.includes('"path"')) {
                    console.warn(`关闭时跳过写入错误响应 (${viewId}):`, contentToWrite.substring(0, 100));
                    return; // 不写入错误JSON
                }
                lastFlushContent = contentToWrite;
                try {
                    // 直接写入最终内容，不等待之前的flush完成
                    // 使用fetch异步写入，不阻塞
                    fetch('/api/save-file', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ path: filePath, content: contentToWrite })
                    }).catch(err => {
                        console.error(`关闭时写入失败 (${viewId}):`, err);
                    });
                } catch (error) {
                    console.error(`关闭时写入失败 (${viewId}):`, error);
                }
            }
        }
    };
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.loadFileViews = loadFileViews;
    window.handlePaste = handlePaste;
    window.copyContent = copyContent;
    window.copyViewContent = copyViewContent;
    window.selectFileByPath = selectFileByPath;
    window.attachJumpLinkListeners = attachJumpLinkListeners;
    window.handleJump = handleJump;
    window.readCurrentView = readCurrentView;
    window.writeCurrentView = writeCurrentView;
}
