/**
 * 文件管理模块
 * 负责文件浏览、选择、导航等功能
 */

import { state } from '../core/state.js';
import { getDirectory, softDelete } from '../core/api.js';
import { isTableFile, isChapterFile, getTableSortNumber, getTableSortKey, getChapterSortNumber, cleanFileName, isFileFolder, getFileFolderPath, getFileInFolderPath } from '../utils/fileUtils.js';
import { isSupportedFileType } from '../utils/fileUtils.js';

/**
 * 更新当前路径显示栏
 */
function updateCurrentPathDisplay(path) {
    const currentPathDisplay = document.getElementById('current-path-display');
    if (currentPathDisplay && path) {
        currentPathDisplay.textContent = path;
        currentPathDisplay.title = path;
    }
}

/**
 * 加载目录
 */
export async function loadDir(path) {
    try {
        const data = await getDirectory(path || '.');
        state.currentDir = data.path;
        const dirPathInput = document.getElementById('dir-path');
        if (dirPathInput) {
            dirPathInput.value = data.path;
        }
        
        // 更新当前路径显示栏
        updateCurrentPathDisplay(data.path);
        
        // 保存当前目录到 localStorage
        localStorage.setItem('lastOpenedDir', data.path);
        
        renderList(data);
        
        // 返回一个Promise，确保DOM更新完成
        return new Promise(resolve => {
            setTimeout(resolve, 50);
        });
    } catch (e) {
        console.error('Error loading directory:', e);
        alert('错误: ' + e.message);
        return Promise.reject(e);
    }
}

/**
 * 渲染文件列表
 */
export function renderList(data) {
    const list = document.getElementById('file-list');
    const mobileList = document.getElementById('mobile-file-list');
    if (!list) return;
    
    list.innerHTML = '';
    if (mobileList) mobileList.innerHTML = '';
    state.files = [];
    state.selectedIndex = -1;
    state.currentFileItem = null;

    // 渲染目录（隐藏与文件名同名的文件夹）
    data.directories.forEach(dir => {
        // 跳过软删除的目录
        if (dir.name.endsWith('.deleted')) return;
        
        // 隐藏与文件名同名的文件夹（去掉扩展名后比较）
        if (isFileFolder(dir.name, data.files)) {
            return; // 不显示与文件名同名的文件夹
        }

        const li = createLi(dir.name, 'type-dir', dir.path, true);
        li.dataset.path = dir.path;
        li.ondblclick = () => {
            selectFolder(li, dir.path);
            if (window.enterDirectory) {
                window.enterDirectory();
            }
        };
        list.appendChild(li);
        
        // 同时添加到移动端列表
        if (mobileList) {
            const mobileLi = li.cloneNode(true);
            // 重新设置路径属性
            mobileLi.dataset.path = dir.path;
            
            // 移动端：第一次点击选中，第二次点击打开
            let lastClickTime = 0;
            let lastClickTarget = null;
            const DOUBLE_CLICK_DELAY = 500; // 500ms内第二次点击视为打开
            
            mobileLi.onclick = async (e) => {
                e.stopPropagation();
                const now = Date.now();
                const isSameTarget = lastClickTarget === mobileLi;
                const isDoubleClick = isSameTarget && (now - lastClickTime) < DOUBLE_CLICK_DELAY;
                
                if (isDoubleClick) {
                    // 第二次点击：打开文件夹
                    lastClickTime = 0;
                    lastClickTarget = null;
                    
                    // 先选择文件夹
                    selectFolder(mobileLi, dir.path);
                    
                    // 直接使用 dir.path 进入文件夹
                    if (!state.dirStack) state.dirStack = [];
                    if (!state.folderStack) state.folderStack = [];
                    
                    state.dirStack.push(state.currentDir);
                    state.folderStack.push(dir.path);
                    state.currentContext = 'dir';
                    state.fileJumpStack = [];
                    await loadDir(dir.path);
                    
                    // 进入目录后不关闭移动端下拉菜单（保持显示）
                } else {
                    // 第一次点击：只选中文件夹
                    lastClickTime = now;
                    lastClickTarget = mobileLi;
                    selectFolder(mobileLi, dir.path);
                }
            };
            
            mobileList.appendChild(mobileLi);
        }
    });

    // 分离表文件、章文件和其他文件
    const tableFiles = [];
    const chapterFiles = [];
    const otherFiles = [];
    
    data.files.forEach(file => {
        // 跳过软删除的文件
        if (file.name.endsWith('.deleted')) return;

        // 只显示md和txt文件，隐藏所有其他文件（压缩包、pdf等）
        const fileName = file.name.toLowerCase();
        const isMdFile = fileName.endsWith('.md');
        const isTxtFile = fileName.endsWith('.txt');
        if (!isMdFile && !isTxtFile) {
            return; // 隐藏非md/txt文件
        }

        // 检查是否应该隐藏（基于视图后缀）
        let shouldHide = false;
        if (state.views) {
            for (const view of state.views) {
                if (view.suffix && view.suffix.trim() !== '') {
                    const suffix = view.suffix;
                    if ((file.name.toLowerCase().endsWith(suffix.toLowerCase() + '.md') ||
                         file.name.toLowerCase().endsWith(suffix.toLowerCase() + '.txt'))) {
                        const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.'));
                        const potentialBaseName = nameWithoutExt.slice(0, -suffix.length);
                        const hasMainFile = data.files.some(f => {
                            const mainNameWithoutExt = f.name.substring(0, f.name.lastIndexOf('.'));
                            return mainNameWithoutExt === potentialBaseName &&
                                   f.name !== file.name &&
                                   (f.name.toLowerCase().endsWith('.md') || f.name.toLowerCase().endsWith('.txt'));
                        });
                        if (hasMainFile) {
                            shouldHide = true;
                            break;
                        }
                    }
                }
            }
        }
        if (shouldHide) return;

        // 判断文件类型
        if (isTableFile(file.name)) {
            tableFiles.push(file);
        } else if (isChapterFile(file.name)) {
            chapterFiles.push(file);
        } else {
            otherFiles.push(file);
        }
    });
    
    // 对表文件进行多级排序：先按第一个数字，再按第二个数字
    tableFiles.sort((a, b) => {
        const keyA = getTableSortKey(a.name);
        const keyB = getTableSortKey(b.name);
        
        // 先比较第一个数字（表1 vs 表2）
        if (keyA[0] !== keyB[0]) {
            return keyA[0] - keyB[0];
        }
        
        // 如果第一个数字相同，再比较第二个数字（1-10 vs 1-2）
        if (keyA.length > 1 && keyB.length > 1) {
            return keyA[1] - keyB[1];
        }
        
        // 如果只有一个数字，单数字的排在前面
        if (keyA.length === 1 && keyB.length > 1) {
            return -1;
        }
        if (keyA.length > 1 && keyB.length === 1) {
            return 1;
        }
        
        // 如果格式相同，按原始名称排序
        return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
    });
    
    // 对章文件按数字排序
    chapterFiles.sort((a, b) => {
        const numA = getChapterSortNumber(a.name);
        const numB = getChapterSortNumber(b.name);
        return numA - numB;
    });
    
    // 对其他文件按名称排序
    otherFiles.sort((a, b) => {
        return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
    });
    
    // 渲染文件
    [...tableFiles, ...chapterFiles, ...otherFiles].forEach(file => {
        const displayName = cleanFileName(file.name);
        const li = createLi(displayName, 'type-file', file.path, false);
        li.title = file.name;
        list.appendChild(li);
        
        // 同时添加到移动端列表
        if (mobileList) {
            const mobileLi = li.cloneNode(true);
            // 重新设置路径和标题属性
            mobileLi.dataset.path = file.path;
            mobileLi.title = file.name;
            // 重新绑定点击事件（确保事件正确绑定）
            mobileLi.onclick = (e) => {
                e.stopPropagation();
                // 关键修复：只有在工作流执行状态存在且确实在执行时才检查，避免不必要的判定
                // 如果workflowExecutionState为null，说明没有工作流在执行，直接允许切换文件
                if (state.workflowExecutionState) {
                    // 检查工作流是否正在执行（锁定文件切换）
                    const execState = state.workflowExecutionState;
                    const isWorkflowExecuting = state.isWorkflowExecuting || 
                        (!execState.isCompleted && 
                         !execState.isCancelled &&
                         execState.executingSteps &&
                         (execState.executingSteps.size > 0 || execState.executedSteps.length > 0));
                    
                    // 如果工作流正在执行，不允许切换文件
                    if (isWorkflowExecuting) {
                        return;
                    }
                }
                
                // 选择文件
                selectFile(mobileLi, file.path);
                // 点击文件后关闭移动端下拉菜单
                const mobileIndexDropdown = document.getElementById('mobile-index-dropdown');
                if (mobileIndexDropdown) {
                    mobileIndexDropdown.style.display = 'none';
                }
            };
            mobileList.appendChild(mobileLi);
        }
    });
}

/**
 * 创建列表项
 */
function createLi(text, typeClass, path, isDir) {
    const li = document.createElement('li');
    li.className = `file-item ${typeClass}`;
    
    // 使用固定的图标容器，避免布局跳动
    const iconNormal = isDir ? '📁' : '📄';
    const iconHover = isDir ? '📂' : '📃';
    const iconSelected = isDir ? '📂' : '📄';
    
    li.innerHTML = `
        <div style="display: flex; align-items: center; width: 100%;">
            <span class="file-item-icon" style="display: inline-block; width: 20px; text-align: center; flex-shrink: 0;" data-icon-normal="${iconNormal}" data-icon-hover="${iconHover}" data-icon-selected="${iconSelected}">${iconNormal}</span>
            <span class="item-name" style="flex: 1;">${text}</span>
            <button class="soft-delete-btn" style="opacity: 0; margin-left: 8px; background: var(--accent-purple); color: white; border: none; border-radius: 4px; padding: 2px 6px; font-size: 12px; cursor: pointer; transition: opacity 0.2s;">🗑️</button>
        </div>
    `;
    
    const iconEl = li.querySelector('.file-item-icon');
    
    // 悬浮时切换图标
    li.addEventListener('mouseenter', () => {
        if (li.classList.contains('selected')) {
            iconEl.textContent = iconSelected;
        } else {
            iconEl.textContent = iconHover;
        }
    });
    
    li.addEventListener('mouseleave', () => {
        if (li.classList.contains('selected')) {
            iconEl.textContent = iconSelected;
        } else {
            iconEl.textContent = iconNormal;
        }
    });

    // 添加悬停效果显示删除按钮
    li.addEventListener('mouseenter', () => {
        const deleteBtn = li.querySelector('.soft-delete-btn');
        if (deleteBtn) deleteBtn.style.opacity = '1';
    });

    li.addEventListener('mouseleave', () => {
        const deleteBtn = li.querySelector('.soft-delete-btn');
        if (deleteBtn) deleteBtn.style.opacity = '0';
    });

    // 添加删除按钮点击事件
    const deleteBtn = li.querySelector('.soft-delete-btn');
    deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
            await softDelete(path);
            // 重新加载目录
            await loadDir(state.currentDir);
        } catch (error) {
            console.error('删除失败:', error);
            alert('删除失败: ' + error.message);
        }
    });

    li.onclick = () => {
        // 关键修复：只有在工作流执行状态存在且确实在执行时才检查，避免不必要的判定
        // 如果workflowExecutionState为null，说明没有工作流在执行，直接允许切换文件
        if (state.workflowExecutionState) {
            // 检查工作流是否正在执行（锁定文件切换）
            const execState = state.workflowExecutionState;
            const isWorkflowExecuting = state.isWorkflowExecuting || 
                (!execState.isCompleted && 
                 !execState.isCancelled &&
                 execState.executingSteps &&
                 (execState.executingSteps.size > 0 || (execState.executedSteps && execState.executedSteps.length > 0)));
            
            // 如果工作流正在执行，不允许切换文件
            if (isWorkflowExecuting) {
                return;
            }
        }
        
        if (isDir) {
            selectFolder(li, path);
        } else {
            selectFile(li, path);
        }
    };
    
    state.files.push({ el: li, path: path, isDir });
    return li;
}

/**
 * 选择文件夹
 */
export function selectFolder(el, path) {
    // 更新所有项的图标
    state.files.forEach(f => {
        f.el.classList.remove('selected');
        const iconEl = f.el.querySelector('.file-item-icon');
        if (iconEl) {
            iconEl.textContent = iconEl.dataset.iconNormal;
        }
    });
    
    el.classList.add('selected');
    const iconEl = el.querySelector('.file-item-icon');
    if (iconEl) {
        iconEl.textContent = iconEl.dataset.iconSelected;
    }
    
    state.selectedIndex = state.files.findIndex(f => f.el === el);
    state.currentFileItem = state.files[state.selectedIndex];
    state.currentContext = 'dir';
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/**
 * 选择文件
 * @param {HTMLElement} el - 文件元素
 * @param {string} path - 文件路径
 * @param {boolean} skipHistoryPush - 是否跳过历史记录推送
 * @param {boolean} isJump - 是否是跳转操作（跳转时需要滚动到顶部）
 */
export async function selectFile(el, path, skipHistoryPush = false, isJump = false) {
    // 更新所有项的图标
    state.files.forEach(f => {
        f.el.classList.remove('selected');
        const iconEl = f.el.querySelector('.file-item-icon');
        if (iconEl) {
            iconEl.textContent = iconEl.dataset.iconNormal;
        }
    });
    
    el.classList.add('selected');
    const iconEl = el.querySelector('.file-item-icon');
    if (iconEl) {
        iconEl.textContent = iconEl.dataset.iconSelected;
    }
    
    state.selectedIndex = state.files.findIndex(f => f.el === el);
    state.currentFileItem = state.files[state.selectedIndex];
    state.currentContext = 'file';
    
    const currentOriginalPath = state.originalPath;
    
    if (!skipHistoryPush && currentOriginalPath && currentOriginalPath !== path) {
        if (state.fileJumpStack.length === 0 || state.fileJumpStack[state.fileJumpStack.length - 1] !== currentOriginalPath) {
            state.fileJumpStack.push(currentOriginalPath);
        }
    }
    
    // 保存当前状态到 localStorage
    localStorage.setItem('lastOpenedFile', path);
    localStorage.setItem('lastOpenedDir', state.currentDir);
    
    // 如果是跳转操作，滚动到可见区域的顶部（第一个位置）；否则使用 nearest
    if (isJump) {
        // 使用多重延迟确保DOM完全更新后再滚动
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setTimeout(() => {
                    // 获取文件列表容器
                    const fileList = document.getElementById('file-list');
                    if (fileList && el) {
                        // 使用 getBoundingClientRect 计算精确位置
                        const listRect = fileList.getBoundingClientRect();
                        const itemRect = el.getBoundingClientRect();
                        
                        // 计算文件相对于列表容器的位置
                        const relativeTop = itemRect.top - listRect.top;
                        const currentScrollTop = fileList.scrollTop;
                        
                        // 计算目标滚动位置：让文件在列表顶部（考虑 padding）
                        const padding = 12; // 文件列表的 padding
                        const targetScrollTop = currentScrollTop + relativeTop - padding;
                        
                        // 滚动到让文件在列表顶部（第一个位置）
                        fileList.scrollTo({
                            top: Math.max(0, targetScrollTop),
                            behavior: 'smooth'
                        });
                    } else {
                        // 如果找不到容器，使用默认方法
                        el.scrollIntoView({ 
                            block: 'start', 
                            behavior: 'smooth', 
                            inline: 'nearest' 
                        });
                    }
                }, 150);
            });
        });
    } else {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    
    // 加载文件视图
    // 直接使用原路径（文件名文件在根目录，与文件名文件夹同级）
    if (window.loadFileViews) {
        await window.loadFileViews(path);
    }
}

/**
 * 进入目录
 */
export function enterDirectory() {
    if (state.currentFileItem && state.currentFileItem.isDir) {
        if (!state.dirStack) state.dirStack = [];
        if (!state.folderStack) state.folderStack = [];
        
        state.dirStack.push(state.currentDir);
        state.folderStack.push(state.currentFileItem.path);
        state.currentContext = 'dir';
        state.fileJumpStack = [];
        loadDir(state.currentFileItem.path);
    }
}

/**
 * 移动到上一个/下一个选择
 */
export function moveSelection(step) {
    if (state.files.length === 0) return;
    
    let newIndex = state.selectedIndex + step;
    if (newIndex < 0) newIndex = state.files.length - 1;
    if (newIndex >= state.files.length) newIndex = 0;
    
    state.selectedIndex = newIndex;
    state.currentFileItem = state.files[newIndex];
    
    const selectedEl = state.files[newIndex].el;
    state.files.forEach(f => f.el.classList.remove('selected'));
    selectedEl.classList.add('selected');
    selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/**
 * 返回到上一个文件
 */
export async function goToPreviousFile() {
    if (state.currentContext === 'file' && state.fileJumpStack && state.fileJumpStack.length > 0) {
        const previousFile = state.fileJumpStack.pop();
        if (window.selectFileByPath) {
            await window.selectFileByPath(previousFile);
        }
    } else if (state.dirStack && state.dirStack.length > 0) {
        state.currentContext = 'dir';
        const previousDir = state.dirStack.pop();
        const previousFolder = state.folderStack ? state.folderStack.pop() : null;
        
        await loadDir(previousDir);
        
        setTimeout(() => {
            if (previousFolder) {
                const folderItem = Array.from(document.querySelectorAll('.file-item.type-dir')).find(item =>
                    item.dataset.path === previousFolder
                );
                if (folderItem) {
                    selectFolder(folderItem, previousFolder);
                    folderItem.scrollIntoView({ block: 'nearest' });
                }
            }
        }, 100);
    } else {
        // 返回上一级目录
        const parts = state.currentDir.replace(/\\/g, '/').split('/');
        if (parts.length > 1) {
            parts.pop();
            await loadDir(parts.join('/') || '.');
        }
    }
}

// 导出工具函数供其他模块使用
export { isSupportedFileType };
