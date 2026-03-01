/**
 * 表格编辑器模块
 * 负责表格增强、全屏编辑和保存
 */

import { state, fullscreenState } from '../core/state.js';
import { saveFile } from '../core/api.js';
import { addToHistory } from '../utils/history.js';
import { processContent, getCleanText, convertHtmlTableToMarkdown } from '../utils/markdownConverter.js';

/**
 * 增强表格
 */
export function enhanceTables() {
    const containers = document.querySelectorAll('.md-render');
    containers.forEach(container => {
        const tables = container.querySelectorAll('table');
        tables.forEach(table => {
            // 移除已存在的按钮
            table.querySelectorAll('.cell-expand-btn, .row-expand-btn, .hover-title').forEach(el => el.remove());

            const rows = table.querySelectorAll('tr');
            rows.forEach((row, rowIndex) => {
                const cells = row.querySelectorAll('th, td');
                let firstCell = null;
                
                cells.forEach((cell, colIndex) => {
                    if (colIndex === 0) {
                        firstCell = cell;
                    }

                    // 单元格展开按钮
                    const cellBtn = document.createElement('button');
                    cellBtn.className = 'cell-expand-btn';
                    cellBtn.textContent = '>';
                    cellBtn.onclick = (e) => {
                        e.stopPropagation();
                        showFullscreen(rowIndex, colIndex, table, true);
                    };
                    cell.appendChild(cellBtn);

                    // 悬停提示
                    cell.onmouseover = () => {
                        if (cell.querySelector('.hover-title')) return;
                        const hoverTitle = document.createElement('div');
                        hoverTitle.className = 'hover-title';
                        hoverTitle.style.cssText = `
                            position: absolute;
                            top: -30px;
                            left: 0;
                            background: var(--bg-tertiary);
                            color: var(--text-primary);
                            padding: 4px 8px;
                            border-radius: 4px;
                            font-size: 11px;
                            white-space: nowrap;
                            z-index: 10;
                            border: 1px solid var(--border);
                        `;
                        const rowTitle = rowIndex === 0 ? 'Header Row' : getCleanText(table.rows[rowIndex].cells[0]) || `Row ${rowIndex}`;
                        const colTitle = colIndex === 0 ? 'Header Col' : getCleanText(table.rows[0].cells[colIndex]) || `Col ${colIndex}`;
                        hoverTitle.textContent = `${rowTitle} - ${colTitle}`;
                        cell.appendChild(hoverTitle);
                    };
                    
                    cell.onmouseout = () => {
                        const hover = cell.querySelector('.hover-title');
                        if (hover) hover.remove();
                    };

                    // 点击进入编辑
                    cell.onclick = (e) => {
                        const jumpLink = e.target.closest('.jump-link');
                        if (jumpLink) {
                            e.preventDefault();
                            e.stopPropagation();
                            if (window.handleJump) {
                                window.handleJump(jumpLink.getAttribute('data-jump'));
                            }
                            return;
                        }
                        
                        if (e.target.closest('.cell-expand-btn, .row-expand-btn')) {
                            return;
                        }
                        
                        e.preventDefault();
                        e.stopPropagation();
                        showFullscreen(rowIndex, colIndex, table, true);
                    };

                    // 双击进入编辑
                    cell.ondblclick = (e) => {
                        e.stopPropagation();
                        showFullscreen(rowIndex, colIndex, table, true);
                    };
                });

                // 行展开按钮
                if (rowIndex > 0 && firstCell) {
                    const rowBtn = document.createElement('button');
                    rowBtn.className = 'row-expand-btn';
                    rowBtn.textContent = '>>';
                    rowBtn.onclick = (e) => {
                        e.stopPropagation();
                        showFullscreen(rowIndex, 0, table, true);
                    };
                    firstCell.style.position = 'relative';
                    firstCell.appendChild(rowBtn);
                }
            });
        });

        // 渲染Mermaid图表
        if (window.renderMdDiagrams) {
            window.renderMdDiagrams(container);
        }

        // 绑定跳转链接
        if (window.attachJumpLinkListeners) {
            window.attachJumpLinkListeners(container);
        }
    });
}

/**
 * 显示全屏编辑
 */
export function showFullscreen(rowIndex, colIndex, table, fromMouseClick = false) {
    const modal = document.getElementById('fullscreen-modal');
    const body = document.getElementById('fullscreen-body');
    if (!modal || !body) return;
    
    fullscreenState.currentRow = rowIndex;
    fullscreenState.currentCol = colIndex;
    fullscreenState.currentTable = table;
    fullscreenState.shouldAutoFocus = fromMouseClick;

    // 找到表格所属的视图ID
    let paneElement = table.closest('[id^="view-"]');
    if (paneElement) {
        const paneId = paneElement.id.replace('view-', '');
        fullscreenState.currentPaneId = paneId;
    } else {
        fullscreenState.currentPaneId = null;
    }

    const numCols = table.rows[0].cells.length;
    const numRows = table.rows.length;
    const row = table.rows[rowIndex];
    const rowTitle = getCleanText(row.cells[0]) || `Row ${rowIndex}`;

    let editableTableHTML = '';

    if (colIndex === 0) {
        // 行模式
        const headers = [];
        const values = [];

        for (let i = 1; i < numCols; i++) {
            let headerCellClone = table.rows[0].cells[i].cloneNode(true);
            headerCellClone.querySelectorAll('.cell-expand-btn, .row-expand-btn, .hover-title').forEach(el => el.remove());
            const headerContent = headerCellClone.innerHTML;
            headers.push(`<th contenteditable="true">${headerContent}</th>`);

            let cellClone = row.cells[i].cloneNode(true);
            cellClone.querySelectorAll('.cell-expand-btn, .row-expand-btn, .hover-title').forEach(el => el.remove());
            const cellContent = cellClone.innerHTML;
            values.push(`<td contenteditable="true">${cellContent}</td>`);
        }

        if (headers.length > 0) {
            editableTableHTML = `
                <table style="width: 100%; margin: 0;">
                    <thead>
                        <tr>
                            <th contenteditable="true">概念</th>
                            ${headers.join('')}
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <th contenteditable="true" style="min-width: 120px;">${rowTitle}</th>
                            ${values.join('')}
                        </tr>
                    </tbody>
                </table>
            `;
        } else {
            editableTableHTML = '<p style="text-align: center; color: var(--text-muted);">无额外列内容</p>';
        }
    } else {
        // 单元格模式
        if (colIndex >= numCols) return;
        const colTitle = getCleanText(table.rows[0].cells[colIndex]) || `Col ${colIndex}`;

        let cellClone = row.cells[colIndex].cloneNode(true);
        cellClone.querySelectorAll('.cell-expand-btn, .row-expand-btn, .hover-title').forEach(el => el.remove());
        const cellContent = cellClone.innerHTML;

        editableTableHTML = `
            <table style="width: 100%; margin: 0;">
                <thead>
                    <tr>
                        <th colspan="2" contenteditable="true">${rowTitle}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <th contenteditable="true" style="min-width: 120px;">${colTitle}</th>
                        <td contenteditable="true" style="min-height: 200px;">${cellContent}</td>
                    </tr>
                </tbody>
            </table>
        `;
    }

    // 创建编辑器HTML
    const editorHTML = `
        <div style="display: flex; flex-direction: column; height: 100%; width: 100%;">
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-bottom: 1px solid var(--border); background: var(--bg-tertiary);">
                <div style="color: var(--text-secondary); font-size: 18px; font-weight: bold; line-height: 1;">
                    ${rowTitle}
                </div>
                <div style="display: flex; gap: 12px;">
                    <button id="fullscreen-save-btn" style="
                        background: var(--accent-blue);
                        color: white;
                        border: none;
                        padding: 8px 20px;
                        border-radius: var(--border-radius);
                        cursor: pointer;
                        font-size: 14px;
                        font-weight: 500;
                        transition: all 0.2s;
                    " onmouseover="this.style.background='var(--accent-purple)'" onmouseout="this.style.background='var(--accent-blue)'">
                        保存
                    </button>
                </div>
            </div>
            <div style="flex: 1; overflow: auto; padding: 20px; background: var(--bg-pane);">
                <div class="md-render" id="fullscreen-editor" style="max-width: 1200px; margin: 0 auto;">
                    ${editableTableHTML}
                </div>
            </div>
            <style>
                #fullscreen-editor th[contenteditable="true"],
                #fullscreen-editor td[contenteditable="true"] {
                    outline: 2px solid var(--accent-blue);
                    outline-offset: -2px;
                    background: var(--bg-secondary);
                    min-height: 100px;
                    padding: 16px;
                    border-radius: var(--border-radius);
                    cursor: text;
                }
                #fullscreen-editor th[contenteditable="true"]:focus,
                #fullscreen-editor td[contenteditable="true"]:focus {
                    outline-color: var(--accent-purple);
                    background: var(--bg-tertiary);
                }
                #fullscreen-editor th[contenteditable="true"]:hover,
                #fullscreen-editor td[contenteditable="true"]:hover {
                    outline-color: var(--accent-cyan);
                }
            </style>
        </div>
    `;

    body.innerHTML = editorHTML;
    modal.style.display = 'flex';

    // 绑定保存按钮
    const saveBtn = document.getElementById('fullscreen-save-btn');
    if (saveBtn) {
        saveBtn.onclick = async () => {
            await saveFullscreenEditor();
        };
    }

    // 处理跳转链接
    const editor = document.getElementById('fullscreen-editor');
    if (editor) {
        const processedContent = processContent(editor.innerHTML);
        editor.innerHTML = processedContent;
        
        const allCells = editor.querySelectorAll('th, td');
        allCells.forEach(cell => {
            cell.setAttribute('contenteditable', 'true');
        });
        
        if (window.attachJumpLinkListeners) {
            window.attachJumpLinkListeners(editor);
        }
        
        // 自动聚焦
        if (fromMouseClick) {
            let targetCell = null;
            if (colIndex === 0) {
                targetCell = editor.querySelector('tbody td[contenteditable="true"]');
            } else {
                targetCell = editor.querySelector('td[contenteditable="true"]');
            }
            
            if (targetCell) {
                setTimeout(() => {
                    targetCell.focus();
                    const range = document.createRange();
                    range.selectNodeContents(targetCell);
                    range.collapse(false);
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                }, 100);
            }
        }
    }

    // 设置全屏键盘事件
    setupFullscreenKeyboard();
}

/**
 * 设置全屏键盘事件
 */
function setupFullscreenKeyboard() {
    if (fullscreenState.fullscreenKeydownHandler) {
        document.removeEventListener('keydown', fullscreenState.fullscreenKeydownHandler);
    }
    
    fullscreenState.fullscreenKeydownHandler = (e) => {
        const modal = document.getElementById('fullscreen-modal');
        if (!modal || modal.style.display !== 'flex') return;

        const activeElement = document.activeElement;
        const isEditing = activeElement && (activeElement.isContentEditable || activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA');
        
        // Ctrl+V 粘贴：如果在可编辑元素中，允许浏览器默认行为；否则阻止传播到主界面
        if (e.ctrlKey && e.key === 'v') {
            if (isEditing) {
                // 在可编辑元素中，允许浏览器默认粘贴行为，不阻止事件
                return;
            } else {
                // 不在可编辑元素中，阻止事件传播到主界面，避免调用 handlePaste()
                e.preventDefault();
                e.stopPropagation();
                return;
            }
        }

        // Ctrl+S 保存
        if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            const saveBtn = document.getElementById('fullscreen-save-btn');
            if (saveBtn) {
                saveBtn.click();
            }
            return;
        }
        
        // Escape键关闭
        if (e.key === state.keybinds.escape) {
            if (window.closeFullscreen) window.closeFullscreen();
            return;
        }

        if (isEditing) return;

        // 允许z键
        const isZKey = !e.ctrlKey && e.key.toLowerCase() === state.keybinds.z;
        if (isZKey) return;
        
        // 导航快捷键
        if ([state.keybinds.w, state.keybinds.a, state.keybinds.s, state.keybinds.d].includes(e.key.toLowerCase())) {
            e.preventDefault();
            
            let newRow = fullscreenState.currentRow;
            let newCol = fullscreenState.currentCol;
            const numColsLocal = fullscreenState.currentTable.rows[0].cells.length;
            const numRowsLocal = fullscreenState.currentTable.rows.length;

            switch (e.key.toLowerCase()) {
                case state.keybinds.w:
                    newRow = Math.max(1, newRow - 1);
                    break;
                case state.keybinds.s:
                    newRow = Math.min(numRowsLocal - 1, newRow + 1);
                    break;
                case state.keybinds.a:
                    if (newCol > 0) newCol--;
                    break;
                case state.keybinds.d:
                    if (newCol < numColsLocal - 1) {
                        newCol++;
                    } else {
                        newCol = 0;
                        newRow = Math.min(numRowsLocal - 1, newRow + 1);
                    }
                    break;
            }

            showFullscreen(newRow, newCol, fullscreenState.currentTable, false);
        }
    };
    
    document.addEventListener('keydown', fullscreenState.fullscreenKeydownHandler);
}

/**
 * 保存全屏编辑器内容
 */
export async function saveFullscreenEditor() {
    if (!fullscreenState.currentPaneId || !fullscreenState.currentTable) {
        alert('无法确定保存目标');
        return;
    }

    const editor = document.getElementById('fullscreen-editor');
    if (!editor) {
        alert('编辑器未找到');
        return;
    }

    const editedTable = editor.querySelector('table');
    if (!editedTable) {
        alert('未找到表格');
        return;
    }

    try {
        const currentPath = state.panePaths[fullscreenState.currentPaneId];
        if (!currentPath) {
            alert('无法确定文件路径');
            return;
        }

        let originalContent = state.rawContents[fullscreenState.currentPaneId] || '';
        
        // 更新表格
        const tableClone = fullscreenState.currentTable.cloneNode(true);
        tableClone.querySelectorAll('.cell-expand-btn, .row-expand-btn, .hover-title').forEach(el => el.remove());
        
        if (fullscreenState.currentCol === 0) {
            // 行模式
            const row = tableClone.rows[fullscreenState.currentRow];
            const editedRow = editedTable.querySelector('tbody tr');
            if (editedRow) {
                const editedCells = editedRow.querySelectorAll('th[contenteditable="true"], td[contenteditable="true"]');
                const editedCellsArray = Array.from(editedCells);
                for (let i = 0; i < row.cells.length && i < editedCellsArray.length; i++) {
                    row.cells[i].innerHTML = editedCellsArray[i].innerHTML;
                }
            }
        } else {
            // 单元格模式
            const row = tableClone.rows[fullscreenState.currentRow];
            const editedRow = editedTable.querySelector('tbody tr');
            if (editedRow) {
                const editedCell = editedRow.querySelector('td[contenteditable="true"]');
                if (row && row.cells[fullscreenState.currentCol] && editedCell) {
                    row.cells[fullscreenState.currentCol].innerHTML = editedCell.innerHTML;
                }
            }
        }
        
        // 如果编辑了表头
        if (fullscreenState.currentRow === 0 || fullscreenState.currentCol === 0) {
            const editedHeaderRow = editedTable.querySelector('thead tr');
            if (editedHeaderRow) {
                const editedHeaderCells = editedHeaderRow.querySelectorAll('th[contenteditable="true"]');
                const editedHeaderCellsArray = Array.from(editedHeaderCells);
                const headerRow = tableClone.rows[0];
                for (let i = 0; i < headerRow.cells.length && i < editedHeaderCellsArray.length; i++) {
                    headerRow.cells[i].innerHTML = editedHeaderCellsArray[i].innerHTML;
                }
            }
        }

        // 转换为Markdown
        const updatedTableMarkdown = convertHtmlTableToMarkdown(tableClone);
        const originalTableMarkdown = convertHtmlTableToMarkdown(fullscreenState.currentTable);
        
        // 替换表格
        if (originalContent.includes(originalTableMarkdown)) {
            originalContent = originalContent.replace(originalTableMarkdown, updatedTableMarkdown);
        } else {
            // 更灵活的匹配
            const lines = originalContent.split('\n');
            let tableStartLine = -1;
            let tableEndLine = -1;
            let inTable = false;
            let tableLineCount = 0;
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.includes('|') && !inTable) {
                    tableStartLine = i;
                    inTable = true;
                    tableLineCount = 1;
                } else if (inTable) {
                    if (line.includes('|') || line.match(/^[\s\-:]+$/)) {
                        tableLineCount++;
                    } else if (line === '' || (!line.includes('|') && !line.match(/^[\s\-:]+$/))) {
                        const originalLines = originalTableMarkdown.split('\n').length;
                        if (tableLineCount >= originalLines) {
                            tableEndLine = i;
                            break;
                        }
                    }
                }
            }
            
            if (tableStartLine >= 0) {
                if (tableEndLine < 0) tableEndLine = lines.length;
                const beforeTable = lines.slice(0, tableStartLine).join('\n');
                const afterTable = lines.slice(tableEndLine).join('\n');
                originalContent = beforeTable + (beforeTable ? '\n' : '') + updatedTableMarkdown + (afterTable ? '\n' : '') + afterTable;
            } else {
                originalContent = originalContent + (originalContent ? '\n\n' : '') + updatedTableMarkdown;
            }
        }

        // 保存文件
        await saveFile(currentPath, originalContent);
        
        // 更新状态
        state.rawContents[fullscreenState.currentPaneId] = originalContent;
        addToHistory(fullscreenState.currentPaneId, originalContent);
        
        // 刷新视图
        const viewEl = document.getElementById(`view-${fullscreenState.currentPaneId}`);
        if (viewEl) {
            const html = processContent(marked.parse(originalContent));
            viewEl.innerHTML = DOMPurify.sanitize(html);
            enhanceTables();
            if (window.attachJumpLinkListeners) {
                window.attachJumpLinkListeners(viewEl);
            }
            
            // 重新获取表格引用
            const newTable = viewEl.querySelector('table');
            if (newTable && newTable.rows.length > fullscreenState.currentRow) {
                fullscreenState.currentTable = newTable;
            }
        }

        // 显示成功提示
        const saveBtn = document.getElementById('fullscreen-save-btn');
        if (saveBtn) {
            const originalText = saveBtn.textContent;
            saveBtn.textContent = '✓ 已保存';
            saveBtn.style.background = 'var(--accent-cyan)';
            setTimeout(() => {
                saveBtn.textContent = originalText;
                saveBtn.style.background = 'var(--accent-blue)';
            }, 2000);
        }
    } catch (error) {
        console.error('保存失败:', error);
        alert(`保存失败: ${error.message}`);
    }
}

/**
 * 获取第一个表格
 */
export function getFirstTable(paneId) {
    const pane = document.getElementById(`view-${paneId}`);
    if (!pane) return null;
    const table = pane.querySelector('table');
    return table;
}

/**
 * 关闭全屏
 */
export function closeFullscreen() {
    const modal = document.getElementById('fullscreen-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    if (fullscreenState.fullscreenKeydownHandler) {
        document.removeEventListener('keydown', fullscreenState.fullscreenKeydownHandler);
        fullscreenState.fullscreenKeydownHandler = null;
    }
    fullscreenState.currentPaneId = null;
    fullscreenState.shouldAutoFocus = false;
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.enhanceTables = enhanceTables;
    window.showFullscreen = showFullscreen;
    window.saveFullscreenEditor = saveFullscreenEditor;
    window.getFirstTable = getFirstTable;
    window.closeFullscreen = closeFullscreen;
}
