/**
 * 富文本编辑器模块
 * 用于在主界面视图内容区域进行细粒度编辑（字、词、句、段）
 * 与全屏表格编辑器区分开
 */

import { state } from '../core/state.js';
import { saveFile } from '../core/api.js';
import { processContent, htmlToMarkdown } from '../utils/markdownConverter.js';
import { pathUtils } from '../utils/path.js';
import { renderHtmlWithVDOM } from '../utils/simpleVirtualDom.js';

// marked和DOMPurify是全局的，从CDN加载
const marked = window.marked;
const DOMPurify = window.DOMPurify;

// 编辑器状态：支持多个视图同时编辑
// 使用Map存储每个视图的编辑状态
const editingViews = new Map(); // viewId -> { originalContent, editedContent, editorContent, ... }

// 撤销栈：每个视图ID对应一个撤销历史
const undoStacks = {};

/**
 * 初始化撤销栈
 * @param {string} viewId - 视图ID
 * @param {string} initialContent - 初始HTML内容（不是Markdown）
 */
function initUndoStack(viewId, initialContent) {
    if (!undoStacks[viewId]) {
        undoStacks[viewId] = {
            history: [initialContent],
            index: 0
        };
    } else {
        // 如果已存在，重置为新的初始内容
        undoStacks[viewId] = {
            history: [initialContent],
            index: 0
        };
    }
}

/**
 * 添加到撤销栈
 * @param {string} viewId - 视图ID
 * @param {string} content - 内容
 */
function addToUndoStack(viewId, content) {
    if (!undoStacks[viewId]) {
        initUndoStack(viewId, content);
        return;
    }
    
    const stack = undoStacks[viewId];
    
    // 如果当前内容与栈顶内容相同，不添加
    if (stack.history[stack.index] === content) {
        return;
    }
    
    // 移除当前位置之后的所有历史（当用户撤销后编辑时）
    stack.history = stack.history.slice(0, stack.index + 1);
    
    // 添加新内容
    stack.history.push(content);
    stack.index = stack.history.length - 1;
    
    // 限制历史记录数量（最多50条）
    if (stack.history.length > 50) {
        stack.history.shift();
        stack.index--;
    }
}

/**
 * 撤销操作
 * @param {string} viewId - 视图ID
 * @returns {string|null} 撤销后的内容，如果无法撤销则返回null
 */
function undo(viewId) {
    const stack = undoStacks[viewId];
    if (!stack || stack.index <= 0) {
        return null;
    }
    
    stack.index--;
    return stack.history[stack.index];
}

/**
 * 重做操作
 * @param {string} viewId - 视图ID
 * @returns {string|null} 重做后的内容，如果无法重做则返回null
 */
function redo(viewId) {
    const stack = undoStacks[viewId];
    if (!stack || stack.index >= stack.history.length - 1) {
        return null;
    }
    
    stack.index++;
    return stack.history[stack.index];
}

/**
 * 清理撤销栈
 * @param {string} viewId - 视图ID
 */
function clearUndoStack(viewId) {
    delete undoStacks[viewId];
}

/**
 * 初始化编辑模式（用于视图加载时直接进入编辑模式）
 * @param {string} viewId - 视图ID
 */
export async function initializeEditMode(viewId) {
    // 如果正在编辑其他视图，先退出
    if (editorState.isEditing && editorState.currentViewId !== viewId) {
        await exitEditMode(editorState.currentViewId);
    }
    
    // 如果已经在编辑此视图，不重复进入
    if (editorState.isEditing && editorState.currentViewId === viewId) {
        return;
    }
    
    await _enterEditMode(viewId, null);
}

/**
 * 进入编辑模式（公开函数）
 * @param {string} viewId - 视图ID
 * @param {MouseEvent} clickEvent - 可选的点击事件，用于定位光标
 */
export async function enterEditMode(viewId, clickEvent = null) {
    // 如果已经在编辑此视图，不重复进入
    if (editingViews.has(viewId)) {
        return;
    }
    
    await _enterEditMode(viewId, clickEvent);
}

/**
 * 进入编辑模式（内部函数）
 * @param {string} viewId - 视图ID
 * @param {MouseEvent} clickEvent - 可选的点击事件，用于定位光标
 */
async function _enterEditMode(viewId, clickEvent = null) {
    const viewEl = document.getElementById(`view-${viewId}`);
    if (!viewEl) {
        console.error('视图元素未找到:', `view-${viewId}`);
        return;
    }
    
    // 在进入编辑模式前，先缓存当前视图中已经渲染好的HTML内容，
    // 便于在 state.rawContents 为空时作为兜底数据使用（尤其是长文件场景）。
    const existingViewHtml = viewEl.innerHTML || '';
    const existingViewTextLength = (viewEl.textContent || '').length;
    
    // 获取原始内容（Markdown格式）
    let originalMarkdown = state.rawContents[viewId] || '';
    
    // 如果内容为空或者是错误提示，使用空字符串（允许编辑空内容）
    if (originalMarkdown === "**不支持的文件类型**" || 
        originalMarkdown.includes('文件未找到') ||
        originalMarkdown.includes('不支持的文件类型')) {
        originalMarkdown = '';
    }
    
    // 如果原始内容为空，初始化为空字符串（允许编辑空内容）
    if (!originalMarkdown) {
        originalMarkdown = '';
    }
    
    // 调试日志已关闭：enterEditMode start
    
    // 保存滚动位置
    const scrollTop = viewEl.scrollTop;
    
    // 在进入编辑模式前，保存点击元素的DOM路径和相对坐标（如果有点击事件）
    let clickedElementPath = null;
    let clickRelativePosition = null;
    if (clickEvent) {
        const clickedElement = clickEvent.target;
        // 跳过不可编辑的元素
        if (clickedElement.tagName !== 'BUTTON' && 
            clickedElement.tagName !== 'A' &&
            !clickedElement.closest('button') &&
            !clickedElement.closest('a') &&
            !clickedElement.closest('table')) {
            // 保存点击元素在原始视图中的路径
            clickedElementPath = getElementPath(clickedElement, viewEl);
            
            // 保存点击位置相对于视图容器的坐标（包括滚动位置）
            try {
                const viewRect = viewEl.getBoundingClientRect();
                const clickX = clickEvent.clientX;
                const clickY = clickEvent.clientY;
                
                // 计算相对于视图容器的坐标（包括滚动偏移）
                clickRelativePosition = {
                    x: clickX - viewRect.left + viewEl.scrollLeft,
                    y: clickY - viewRect.top + scrollTop
                };
            } catch (err) {
                console.warn('保存点击位置失败:', err);
            }
        }
    }
    
    // 渲染内容为HTML
    let currentHtml = '';
    if (originalMarkdown && originalMarkdown.trim()) {
        const html = processContent(marked.parse(originalMarkdown));
        currentHtml = DOMPurify.sanitize(html);
    } else {
        // 如果 state.rawContents 中没有内容，但视图里已经有渲染好的长文本，
        // 说明状态链路出了问题，但 DOM 里其实是有内容的。
        // 这种情况下优先使用现有视图的HTML作为编辑初始内容，避免编辑器变成空白。
        if (existingViewTextLength > 0 && existingViewHtml.trim()) {
            // 调试日志已关闭：enterEditMode fallback to existing view HTML
            currentHtml = existingViewHtml;
        } else {
            // 如果视图本身也没有内容，再退回到一个空的编辑区域
            currentHtml = '<p><br></p>';
        }
    }
    
    // 调试日志已关闭：enterEditMode after html render
    
    // 初始化撤销栈：保存HTML内容（不是Markdown）
    initUndoStack(viewId, currentHtml);
    
    // 创建编辑器容器
    const editorContainer = document.createElement('div');
    editorContainer.className = 'rich-text-editor-container';
    editorContainer.style.cssText = `
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
    `;
    
    // 创建保存按钮工具栏
    const toolbar = document.createElement('div');
    toolbar.className = 'rich-text-editor-toolbar';
    
    // 创建保存按钮
    const saveBtn = document.createElement('button');
    saveBtn.className = 'rich-text-editor-save-btn';
    saveBtn.textContent = '保存';
    
    // 保存按钮点击事件
    saveBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await saveParagraphEditor(viewId, false);
    });
    
    toolbar.appendChild(saveBtn);
    
    // 创建可编辑内容区域
    const editorContent = document.createElement('div');
    editorContent.className = 'rich-text-editor-content';
    editorContent.contentEditable = 'true';
    editorContent.style.cssText = `
        padding: 20px;
        min-height: 200px;
        outline: none;
        cursor: text;
        flex: 1;
        overflow-y: auto;
    `;
    
    // 使用虚拟DOM设置内容为当前渲染的HTML
    renderHtmlWithVDOM(editorContent, currentHtml);
    
    // 调试日志已关闭：enterEditMode editorContent mounted
    
    // 组装编辑器
    editorContainer.appendChild(toolbar);
    editorContainer.appendChild(editorContent);
    
    // 清空视图并添加编辑器
    viewEl.innerHTML = '';
    viewEl.appendChild(editorContainer);
    
    // 恢复滚动位置
    setTimeout(() => {
        viewEl.scrollTop = scrollTop;
    }, 50);
    
    // 保存此视图的编辑状态
    editingViews.set(viewId, {
        originalMarkdown: originalMarkdown,
        editorContent: editorContent,
        editorContainer: editorContainer,
        viewEl: viewEl,
        saveBtn: saveBtn
    });
    
    // 设置可编辑元素（跳转链接）
    // 注意：表格不设置为可编辑，保持原来的点击进入全屏编辑功能
    setupEditableElements(editorContent);
    
    // 重新增强表格（恢复原来的点击进入全屏编辑功能）
    if (window.enhanceTables) {
        window.enhanceTables();
    }
    
    // 重新绑定跳转链接（恢复原来的点击跳转功能）
    if (window.attachJumpLinkListeners) {
        window.attachJumpLinkListeners(editorContent);
    }
    
    // 是否正在执行撤销/重做操作（避免触发输入事件）
    let isUndoRedoInProgress = false;
    
    // 撤销栈添加定时器（使用防抖，避免过于频繁添加）
    let undoStackTimer = null;
    const undoStackDelay = 300; // 300ms后添加到撤销栈
    
    // 监听输入事件（只用于撤销栈，不自动保存）
    editorContent.addEventListener('input', () => {
        // 如果正在执行撤销/重做，不处理
        if (isUndoRedoInProgress) {
            return;
        }
        
        // 清除之前的撤销栈定时器
        if (undoStackTimer) {
            clearTimeout(undoStackTimer);
        }
        
        // 延迟添加到撤销栈（使用防抖）
        undoStackTimer = setTimeout(() => {
            const currentContent = editorContent.innerHTML;
            addToUndoStack(viewId, currentContent);
        }, undoStackDelay);
    });
    
    // 键盘事件处理：撤销/重做
    const keyboardHandler = (e) => {
        // 只在编辑器中处理
        if (!editorContent.contains(e.target) && e.target !== editorContent) {
            return;
        }
        
        // Ctrl+Z: 撤销
        if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            
            const undoContent = undo(viewId);
            if (undoContent !== null) {
                isUndoRedoInProgress = true;
                
                // 使用虚拟DOM恢复内容
                renderHtmlWithVDOM(editorContent, undoContent);
                
                // 重新处理元素
                setupEditableElements(editorContent);
                
                // 重新增强表格（恢复原来的点击进入全屏编辑功能）
                if (window.enhanceTables) {
                    window.enhanceTables();
                }
                
                // 重新绑定跳转链接（恢复原来的点击跳转功能）
                if (window.attachJumpLinkListeners) {
                    window.attachJumpLinkListeners(editorContent);
                }
                
                // 延迟重置标志，避免触发输入事件
                setTimeout(() => {
                    isUndoRedoInProgress = false;
                }, 0);
            }
            return;
        }
        
        // Ctrl+Y 或 Ctrl+Shift+Z: 重做
        if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.key === 'z' && e.shiftKey)) {
            e.preventDefault();
            e.stopPropagation();
            
            const redoContent = redo(viewId);
            if (redoContent !== null) {
                isUndoRedoInProgress = true;
                
                // 使用虚拟DOM恢复内容
                renderHtmlWithVDOM(editorContent, redoContent);
                
                // 重新处理元素
                setupEditableElements(editorContent);
                
                // 重新增强表格（恢复原来的点击进入全屏编辑功能）
                if (window.enhanceTables) {
                    window.enhanceTables();
                }
                
                // 重新绑定跳转链接（恢复原来的点击跳转功能）
                if (window.attachJumpLinkListeners) {
                    window.attachJumpLinkListeners(editorContent);
                }
                
                setTimeout(() => {
                    isUndoRedoInProgress = false;
                }, 0);
            }
            return;
        }
        
        // Ctrl+S: 保存
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            e.stopPropagation();
            
            saveParagraphEditor(viewId, false);
            return;
        }
    };
    
    // 绑定键盘事件
    editorContent.addEventListener('keydown', keyboardHandler);
    
    // 保存处理器引用以便清理
    editorContent._keyboardHandler = keyboardHandler;
    
    // 点击外部区域退出编辑模式（不自动保存）
    const clickOutsideHandler = async (e) => {
        // 如果点击的是保存按钮，不处理（由按钮自己的事件处理）
        if (e.target === saveBtn || saveBtn.contains(e.target)) {
            return;
        }
        
        if (!viewEl.contains(e.target)) {
            // 点击了外部区域，直接退出编辑模式（不保存）
            exitEditMode(viewId);
            if (clickOutsideHandler) {
                document.removeEventListener('click', clickOutsideHandler);
            }
        }
    };
    document.addEventListener('click', clickOutsideHandler);
    
    // 保存处理器引用以便清理
    editorContent._clickOutsideHandler = clickOutsideHandler;
    
    // 添加样式
    addParagraphEditorStyles();
    
    // 更新编辑模式状态显示
    const { updateEditModeStatus } = await import('./viewManager.js');
    await updateEditModeStatus(viewId);
    
    // 定位光标到用户点击的位置（第一次进入编辑模式时）
    setTimeout(() => {
        editorContent.focus();
        
        if (clickEvent) {
            // 获取点击的元素
            const clickedElement = clickEvent.target;
            
            // 跳过不可编辑的元素
            if (clickedElement.tagName === 'BUTTON' || 
                clickedElement.tagName === 'A' ||
                clickedElement.closest('button') ||
                clickedElement.closest('a') ||
                clickedElement.closest('table')) {
                return;
            }
            
            // 使用保存的DOM路径在编辑器中找到对应的元素
            if (clickedElementPath && clickedElementPath.length > 0 && clickRelativePosition) {
                const targetElement = findElementByPath(editorContent, clickedElementPath);
                
                if (targetElement) {
                    try {
                        // 获取编辑器容器的位置和滚动位置
                        const editorRect = editorContent.getBoundingClientRect();
                        const editorScrollTop = viewEl.scrollTop;
                        const editorScrollLeft = viewEl.scrollLeft;
                        
                        // 将保存的相对坐标（包括滚动偏移）转换为屏幕坐标
                        // 先减去滚动偏移，得到相对于编辑器容器的坐标
                        const relativeX = clickRelativePosition.x - editorScrollLeft;
                        const relativeY = clickRelativePosition.y - editorScrollTop;
                        
                        // 转换为屏幕绝对坐标
                        const editorX = editorRect.left + relativeX;
                        const editorY = editorRect.top + relativeY;
                        
                        // 使用计算出的坐标定位光标
                        setCaretFromPoint(editorContent, editorX, editorY);
                    } catch (err) {
                        // 如果定位失败，尝试直接定位到元素
                        try {
                            const range = document.createRange();
                            const selection = window.getSelection();
                            
                            // 如果是文本节点，直接定位
                            if (targetElement.nodeType === Node.TEXT_NODE) {
                                const textLength = targetElement.textContent.length;
                                const offset = Math.min(Math.floor(textLength / 2), textLength);
                                range.setStart(targetElement, offset);
                                range.setEnd(targetElement, offset);
                            } else {
                                // 定位到元素的第一个文本节点
                                const textNode = getFirstTextNode(targetElement);
                                if (textNode) {
                                    range.setStart(textNode, 0);
                                    range.setEnd(textNode, 0);
                                } else {
                                    range.selectNodeContents(targetElement);
                                    range.collapse(true);
                                }
                            }
                            
                            selection.removeAllRanges();
                            selection.addRange(range);
                        } catch (err2) {
                            console.warn('定位光标失败:', err2);
                            // 最后尝试使用原始坐标
                            setCaretFromPoint(editorContent, clickEvent.clientX, clickEvent.clientY);
                        }
                    }
                } else {
                    // 如果找不到对应元素，使用坐标直接定位
                    setCaretFromPoint(editorContent, clickEvent.clientX, clickEvent.clientY);
                }
            } else {
                // 如果没有路径信息，使用坐标直接定位
                setCaretFromPoint(editorContent, clickEvent.clientX, clickEvent.clientY);
            }
        }
    }, 100);
}

/**
 * 设置可编辑元素（表格和跳转链接）
 * @param {HTMLElement} editorContent - 编辑器内容元素
 */
function setupEditableElements(editorContent) {
    // 处理表格：恢复原来的点击进入全屏编辑逻辑，不设置为可编辑
    // 表格的点击事件由 enhanceTables 处理，不需要在这里处理
    
    // 处理跳转链接：保持原来的点击跳转功能，不设置为可编辑
    // 跳转链接的点击事件由 attachJumpLinkListeners 处理，不需要在这里处理
}

/**
 * 获取元素在DOM中的路径（用于定位）
 * @param {Node} element - 目标元素
 * @param {Node} root - 根元素
 * @returns {Array} 路径数组，每个元素是[tagName, index]
 */
function getElementPath(element, root) {
    const path = [];
    let current = element;
    
    while (current && current !== root && current !== document.body) {
        if (current.nodeType === Node.ELEMENT_NODE) {
            const parent = current.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children);
                const index = siblings.indexOf(current);
                path.unshift([current.tagName, index, current.className]);
            }
        } else if (current.nodeType === Node.TEXT_NODE) {
            const parent = current.parentElement;
            if (parent) {
                const textNodes = [];
                const walker = document.createTreeWalker(
                    parent,
                    NodeFilter.SHOW_TEXT,
                    null
                );
                let node;
                while (node = walker.nextNode()) {
                    textNodes.push(node);
                }
                const index = textNodes.indexOf(current);
                path.unshift(['TEXT', index]);
            }
        }
        current = current.parentNode;
    }
    
    return path;
}

/**
 * 根据路径在编辑器中找到对应的元素
 * @param {HTMLElement} editorContent - 编辑器内容
 * @param {Array} path - 元素路径
 * @returns {Node|null} 找到的元素
 */
function findElementByPath(editorContent, path) {
    if (!path || path.length === 0) {
        return null;
    }
    
    let current = editorContent;
    
    for (const [tagName, index, className] of path) {
        if (tagName === 'TEXT') {
            // 文本节点
            const textNodes = [];
            const walker = document.createTreeWalker(
                current,
                NodeFilter.SHOW_TEXT,
                null
            );
            let node;
            while (node = walker.nextNode()) {
                textNodes.push(node);
            }
            if (index >= 0 && index < textNodes.length) {
                current = textNodes[index];
            } else {
                return null;
            }
        } else {
            // 元素节点
            const children = Array.from(current.children).filter(child => 
                child.tagName === tagName && (!className || child.className === className)
            );
            if (index >= 0 && index < children.length) {
                current = children[index];
            } else {
                // 如果精确匹配失败，尝试模糊匹配（只匹配tagName）
                const allChildren = Array.from(current.children).filter(child => 
                    child.tagName === tagName
                );
                if (index >= 0 && index < allChildren.length) {
                    current = allChildren[index];
                } else {
                    return null;
                }
            }
        }
    }
    
    return current;
}

/**
 * 获取元素内的第一个文本节点
 */
function getFirstTextNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
        return node;
    }
    
    const walker = document.createTreeWalker(
        node,
        NodeFilter.SHOW_TEXT,
        null
    );
    
    return walker.nextNode();
}

/**
 * 根据点击坐标设置光标位置
 * @returns {boolean} 是否成功定位
 */
function setCaretFromPoint(container, x, y) {
    try {
        let range = null;
        
        // 优先使用 caretRangeFromPoint（Chrome, Edge）
        if (document.caretRangeFromPoint) {
            range = document.caretRangeFromPoint(x, y);
        } 
        // 使用 caretPositionFromPoint（Firefox）
        else if (document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(x, y);
            if (pos) {
                range = document.createRange();
                range.setStart(pos.offsetNode, pos.offset);
                range.setEnd(pos.offsetNode, pos.offset);
            }
        }
        // 降级方案：使用 document.elementFromPoint
        else {
            const element = document.elementFromPoint(x, y);
            if (element && container.contains(element)) {
                const textNode = getFirstTextNode(element);
                if (textNode) {
                    range = document.createRange();
                    range.setStart(textNode, 0);
                    range.setEnd(textNode, 0);
                } else {
                    range = document.createRange();
                    range.selectNodeContents(element);
                    range.collapse(true);
                }
            }
        }
        
        if (range && container.contains(range.startContainer)) {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            return true;
        }
    } catch (err) {
        console.warn('使用坐标定位光标失败:', err);
    }
    
    return false;
}


/**
 * 添加富文本编辑器样式
 */
function addParagraphEditorStyles() {
    // 检查样式是否已添加
    if (document.getElementById('rich-text-editor-styles')) {
        return;
    }
    
    const style = document.createElement('style');
    style.id = 'rich-text-editor-styles';
    style.textContent = `
        .rich-text-editor-content {
            outline: none;
        }
        
        .rich-text-editor-content:focus {
            outline: 2px solid var(--accent-blue);
            outline-offset: -2px;
        }
        
        .rich-text-editor-content table {
            border-collapse: collapse;
            width: 100%;
            margin: 1em 0;
        }
        
        .rich-text-editor-content table td,
        .rich-text-editor-content table th {
            border: 1px solid var(--border);
            padding: 8px;
            min-width: 50px;
        }
        
        .rich-text-editor-content table td:focus,
        .rich-text-editor-content table th:focus {
            outline: 2px solid var(--accent-blue);
            outline-offset: -2px;
            background: var(--bg-tertiary);
        }
        
        .rich-text-editor-content table td[contenteditable="true"],
        .rich-text-editor-content table th[contenteditable="true"] {
            cursor: text;
        }
        
        .rich-text-editor-content .jump-link {
            cursor: text;
        }
        
        .rich-text-editor-content:empty:before {
            content: '点击开始编辑...';
            color: var(--text-muted);
            font-style: italic;
        }
        
        .rich-text-editor-toolbar {
            padding: 8px 12px;
            background: var(--bg-secondary, var(--surface-1));
            border-bottom: 1px solid var(--border);
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 8px;
            flex-shrink: 0;
        }
        
        .rich-text-editor-save-btn {
            padding: 6px 16px;
            background: var(--accent-blue);
            color: white;
            border: 1px solid var(--accent-blue);
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s;
        }
        
        .rich-text-editor-save-btn:hover {
            background: var(--primary-500, var(--accent-blue));
            opacity: 0.9;
        }
        
        .rich-text-editor-save-btn:active {
            opacity: 0.8;
        }
    `;
    document.head.appendChild(style);
}

/**
 * 临时调试用：将长文本按分片逐步写入 textarea，
 * 用于在移动端上排查一次性赋值导致内容不显示的问题。
 * 
 * 使用方式（在控制台）：
 *   window._debugProgressiveFillTextarea(myTextareaElement, longText, 10000);
 */
function debugProgressiveFillTextarea(textarea, content, chunkSize = 10000) {
    if (!textarea || typeof textarea.value === 'undefined') {
        console.warn('[EditFlow] debugProgressiveFillTextarea: 非 textarea 元素或未找到');
        return;
    }
    if (typeof content !== 'string') {
        console.warn('[EditFlow] debugProgressiveFillTextarea: content 不是字符串');
        return;
    }
    
    textarea.value = '';
    let index = 0;
    const total = content.length;
    
    console.log('[EditFlow] progressive fill start', {
        time: new Date().toISOString(),
        totalLength: total,
        chunkSize
    });
    
    function step() {
        if (index >= total) {
            console.log('[EditFlow] progressive fill finished', {
                time: new Date().toISOString(),
                finalLength: textarea.value.length
            });
            return;
        }
        const nextIndex = Math.min(index + chunkSize, total);
        const slice = content.slice(index, nextIndex);
        textarea.value += slice;
        index = nextIndex;
        
        requestAnimationFrame(step);
    }
    
    requestAnimationFrame(step);
}

/**
 * 保存段落编辑器内容
 * @param {string} viewId - 视图ID
 * @param {boolean} keepEditing - 是否保存后继续编辑（默认false，保存后退出编辑模式）
 */
export async function saveParagraphEditor(viewId, keepEditing = false) {
    if (!editingViews.has(viewId)) {
        return;
    }
    
    const viewState = editingViews.get(viewId);
    const editorContent = viewState.editorContent;
    
    if (!editorContent) {
        alert('编辑器内容未找到');
        return;
    }
    
    try {
        // 克隆内容以便处理（避免影响当前显示）
        const contentClone = editorContent.cloneNode(true);
        
        // 清理不需要的元素（如编辑按钮）
        const buttons = contentClone.querySelectorAll('.cell-expand-btn, .row-expand-btn, .hover-title');
        buttons.forEach(btn => btn.remove());
        
        // 将HTML转换为Markdown
        const markdownContent = htmlToMarkdown(contentClone.innerHTML);
        
        // 获取文件路径
        let filePath = state.panePaths[viewId];
        
        // 如果当前是在“新建文件”模式，且还没有确定文件路径，
        // 则在第一次保存时弹出文件名输入框，并根据用户输入生成真实路径。
        if (!filePath && state.isCreatingNewFile) {
            const currentDir = state.newFileDir || state.currentDir || document.getElementById('dir-path')?.value || '.';
            
            let fileName = prompt('请输入新文件名（可不写扩展名，默认 .md）:');
            if (!fileName) {
                // 用户取消命名，终止保存
                return;
            }
            
            fileName = fileName.trim();
            if (!fileName) {
                alert('文件名不能为空');
                return;
            }
            
            // 兼容 "xxx." 这种情况，先去掉末尾的点
            if (fileName.endsWith('.')) {
                fileName = fileName.slice(0, -1);
            }
            
            // 如果用户没有写后缀，默认添加 .md
            const lastDotIndexInput = fileName.lastIndexOf('.');
            if (lastDotIndexInput === -1 || lastDotIndexInput === fileName.length - 1) {
                fileName = fileName + '.md';
            }
            
            // 计算主文件完整路径
            const basePath = pathUtils.join(currentDir, fileName).replace(/\\/g, '/');
            state.originalPath = basePath;
            state.isFirstCreateAfterReload = false;
            if (!state.panePaths) state.panePaths = {};
            if (!state.originalPanePaths) state.originalPanePaths = {};
            
            // 根据视图配置为所有视图生成各自的文件路径（与 loadFileViews 逻辑保持一致）
            const lastSeparatorIndex = Math.max(basePath.lastIndexOf('\\'), basePath.lastIndexOf('/'));
            const dir = lastSeparatorIndex >= 0 ? basePath.substring(0, lastSeparatorIndex + 1) : '';
            const baseFileName = lastSeparatorIndex >= 0 ? basePath.substring(lastSeparatorIndex + 1) : basePath;
            const lastDotIndex = baseFileName.lastIndexOf('.');
            const baseName = lastDotIndex > 0 ? baseFileName.substring(0, lastDotIndex) : baseFileName;
            const ext = lastDotIndex > 0 ? baseFileName.substring(lastDotIndex + 1).trim() : '';
            
            const { getFileFolderPath, getFileInFolderPath } = await import('../utils/fileUtils.js');
            
            // 创建文件名文件夹（用于保存其他视图和AI文件）
            const fileFolderPath = getFileFolderPath(basePath);
            try {
                await createFolder(fileFolderPath);
            } catch (err) {
                // 文件夹可能已存在，忽略
            }
            
            // 为每个视图生成路径
            if (state.views && Array.isArray(state.views)) {
                for (const view of state.views) {
                    const paneId = view.id;
                    const hasSuffix = view.suffix !== undefined &&
                                      view.suffix !== null &&
                                      String(view.suffix).trim() !== '';
                    const targetFileName = `${baseName}${view.suffix || ''}${ext ? '.' + ext : ''}`;
                    
                    let targetPath;
                    if (!hasSuffix) {
                        // 主视图：保存在当前目录
                        targetPath = pathUtils.join(dir, targetFileName).replace(/\\/g, '/');
                    } else {
                        // 其他视图：保存在文件名文件夹内
                        targetPath = getFileInFolderPath(basePath, targetFileName);
                    }
                    
                    state.panePaths[paneId] = targetPath;
                    state.originalPanePaths[paneId] = targetPath;
                }
            }
            
            // 当前视图对应的实际文件路径
            filePath = state.panePaths[viewId];
            // 新建流程只在第一次保存时执行，后续保存不再弹出文件名
            state.isCreatingNewFile = false;
        }
        
        if (!filePath) {
            alert('无法确定文件路径');
            return;
        }
        
        // 保存文件
        await saveFile(filePath, markdownContent);
        
        // 更新状态
        state.rawContents[viewId] = markdownContent;
        viewState.editedContent = markdownContent;
        
        // 显示保存成功提示
        const saveBtn = viewState.saveBtn;
        if (saveBtn) {
            const originalText = saveBtn.textContent;
            saveBtn.textContent = '已保存';
            saveBtn.style.background = 'var(--accent-green, #4caf50)';
            setTimeout(() => {
                saveBtn.textContent = originalText;
                saveBtn.style.background = 'var(--accent-blue)';
            }, 1500);
        }
        
        if (!keepEditing) {
            // 保存后退出编辑模式
            // 注意：exitEditMode 内部已经会调用 loadSingleView 刷新视图，
            // 这里不需要再重复刷新一次，否则可能导致界面同时保留只读视图和编辑块两份内容。
            await exitEditMode(viewId);
            
            // 通知另一个窗口刷新DOM（如果视图已分离）
            await notifyOtherWindowRefresh(viewId);
        } else {
            // 保存后继续编辑（不退出编辑模式）
            console.log('保存成功');
            
            // 即使继续编辑，也要通知另一个窗口刷新DOM
            await notifyOtherWindowRefresh(viewId);
        }
        
        // 如果是新建文件第一次保存后，需要刷新左侧目录列表，以显示新文件
        if (window.loadDir && state.newFileDir) {
            setTimeout(() => {
                window.loadDir(state.newFileDir);
            }, 200);
        }
    } catch (error) {
        console.error('保存失败:', error);
        alert(`保存失败: ${error.message}`);
        
        // 显示保存失败提示
        const saveBtn = viewState.saveBtn;
        if (saveBtn) {
            const originalText = saveBtn.textContent;
            saveBtn.textContent = '保存失败';
            saveBtn.style.background = 'var(--accent-red, #f44336)';
            setTimeout(() => {
                saveBtn.textContent = originalText;
                saveBtn.style.background = 'var(--accent-blue)';
            }, 2000);
        }
    }
}

/**
 * 退出编辑模式
 * @param {string} viewId - 视图ID
 */
export async function exitEditMode(viewId) {
    if (!editingViews.has(viewId)) {
        return;
    }
    
    const viewState = editingViews.get(viewId);
    const editorContent = viewState.editorContent;
    
    // 清理事件监听器
    if (editorContent) {
        if (editorContent._clickOutsideHandler) {
            document.removeEventListener('click', editorContent._clickOutsideHandler);
            editorContent._clickOutsideHandler = null;
        }
        if (editorContent._keyboardHandler) {
            editorContent.removeEventListener('keydown', editorContent._keyboardHandler);
            editorContent._keyboardHandler = null;
        }
    }
    
    // 清理撤销栈
    clearUndoStack(viewId);
    
    // 从编辑视图Map中移除
    editingViews.delete(viewId);
    
    // 更新编辑模式状态显示（在重新加载视图之前）
    const { updateEditModeStatus } = await import('./viewManager.js');
    await updateEditModeStatus(viewId);
    
    // 重新加载视图前，先把当前视图容器彻底清空，避免残留编辑块或重复内容
    try {
        const viewEl = document.getElementById(`view-${viewId}`);
        if (viewEl) {
            viewEl.innerHTML = '';
            // 确保容器本身是只读的，真正的编辑区域由段落编辑器单独创建
            viewEl.contentEditable = 'false';
        }
    } catch (e) {
        console.warn('清理编辑视图容器失败:', e);
    }
    
    // 重新加载视图（恢复原始显示）
    // 传入skipEditModeRestore=true，避免从localStorage恢复旧状态（状态已由调用者保存）
    const { loadSingleView } = await import('./viewManager.js');
    await loadSingleView(viewId, true);
    
    // 重新加载后再次更新状态（确保按钮状态正确）
    await updateEditModeStatus(viewId);
}

/**
 * 检查指定视图是否在编辑模式
 * @param {string} viewId - 视图ID（可选，如果不提供则检查是否有任何视图在编辑）
 * @returns {boolean}
 */
export function isInEditMode(viewId = null) {
    if (viewId) {
        return editingViews.has(viewId);
    }
    return editingViews.size > 0;
}

/**
 * 获取所有正在编辑的视图ID
 * @returns {Array<string>}
 */
export function getEditingViewIds() {
    return Array.from(editingViews.keys());
}

/**
 * 检查指定视图是否在编辑模式（兼容旧接口）
 * @returns {boolean}
 */
export function getCurrentEditingViewId() {
    // 返回第一个编辑的视图ID（兼容旧代码）
    const viewIds = Array.from(editingViews.keys());
    return viewIds.length > 0 ? viewIds[0] : null;
}

/**
 * 切换段落编辑模式（公开函数）
 * @param {string} viewId - 视图ID
 */
export async function toggleParagraphEditMode(viewId) {
    if (editingViews.has(viewId)) {
        // 如果正在编辑此视图，则退出编辑模式
        await exitEditMode(viewId);
    } else {
        // 否则进入编辑模式
        await enterEditMode(viewId);
    }
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.toggleParagraphEditMode = toggleParagraphEditMode;
    window.saveParagraphEditor = saveParagraphEditor;
    window.isInParagraphEditMode = isInEditMode;
    window.enterParagraphEditMode = enterEditMode;
    window._debugProgressiveFillTextarea = debugProgressiveFillTextarea;
}

/**
 * 通知另一个窗口刷新DOM
 * @param {string} viewId - 视图ID
 */
async function notifyOtherWindowRefresh(viewId) {
    try {
        // 判断当前是否在分离窗口
        const isSeparatedWindow = (window.opener && !window.opener.closed) || 
                                  window.location.pathname.includes('separated-view.html');
        
        if (isSeparatedWindow) {
            // 在分离窗口中，通知主窗口刷新
            // 分离窗口通过 channelId 发送消息给主窗口
            if (window.channelId) {
                const { sendMessage } = await import('./dragSeparator/communication.js');
                sendMessage(window.channelId, 'VIEW_CONTENT_REFRESHED', { viewId });
                console.log(`[分离窗口] 已通知主窗口刷新视图 ${viewId}`);
            } else {
                console.warn('[分离窗口] 无法获取 channelId，无法通知主窗口刷新');
            }
        } else {
            // 在主窗口中，检查视图是否已分离，如果已分离则通知分离窗口刷新
            try {
                const { notifySeparatedWindowRefresh } = await import('./dragSeparator/index.js');
                await notifySeparatedWindowRefresh(viewId);
            } catch (error) {
                console.warn('[主窗口] 通知分离窗口刷新失败:', error);
            }
        }
    } catch (error) {
        console.warn('通知另一个窗口刷新失败:', error);
    }
}

