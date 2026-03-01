/**
 * Markdown转换工具模块
 * 负责HTML和Markdown之间的转换
 */

/**
 * 将HTML节点转换为Markdown
 */
export function htmlNodeToMarkdown(node) {
    if (node.nodeType === Node.TEXT_NODE) {
        return node.nodeValue.replace(/\s+/g, ' ');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();
    let md = '';

    const getChildrenMd = () => {
        let s = '';
        node.childNodes.forEach(child => {
            s += htmlNodeToMarkdown(child);
        });
        return s;
    };

    switch (tag) {
        case 'br':
            return '\n';
        case 'strong':
        case 'b':
            return '**' + getChildrenMd().trim() + '**';
        case 'em':
        case 'i':
            return '*' + getChildrenMd().trim() + '*';
        case 'code':
            // 如果在 pre 里，交给 pre 处理
            if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') {
                return node.textContent;
            }
            return '`' + node.textContent + '`';
        case 'pre': {
            const code = node.textContent.replace(/\n+$/, '');
            return '```\n' + code + '\n```\n\n';
        }
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
        case 'h5':
        case 'h6': {
            const level = parseInt(tag.substring(1), 10);
            return '#'.repeat(level) + ' ' + getChildrenMd().trim() + '\n\n';
        }
        case 'p':
            return getChildrenMd().trim() + '\n\n';
        case 'li': {
            const parentTag = node.parentElement ? node.parentElement.tagName.toLowerCase() : '';
            const content = getChildrenMd().trim();
            if (parentTag === 'ol') {
                // 不严格编号，统一用 1.
                return '1. ' + content + '\n';
            } else {
                return '- ' + content + '\n';
            }
        }
        case 'ul':
        case 'ol': {
            let listMd = '';
            node.childNodes.forEach(child => {
                listMd += htmlNodeToMarkdown(child);
            });
            return listMd + '\n';
        }
        case 'blockquote': {
            const inner = getChildrenMd().trim().split('\n').map(l => l ? '> ' + l : '').join('\n');
            return inner + '\n\n';
        }
        case 'table':
            return convertHtmlTableToMarkdown(node) + '\n\n';
        case 'tr':
        case 'td':
        case 'th':
            // 由 table 统一处理，这里返回空
            return '';
        case 'a': {
            const href = node.getAttribute('href') || '';
            const text = getChildrenMd().trim();
            if (!href) return text;
            return '[' + text + '](' + href + ')';
        }
        case 'span':
            if (node.classList.contains('jump-link')) {
                const text = node.textContent.trim();
                return '[[' + text + ']]';
            }
            return getChildrenMd();
        case 'div':
            // 外层卡片：md-diagram，直接还原成 ```mermaid
            if (node.classList.contains('md-diagram')) {
                const src =
                    node.getAttribute('data-md-diagram-source') ||
                    node.dataset.mdDiagramSource ||
                    (node.querySelector('.mermaid')?.dataset.mdDiagramSource) ||
                    (node.querySelector('.mermaid')?.textContent) ||
                    '';
                if (src.trim()) {
                    return '```mermaid\n' + src.trim() + '\n```\n\n';
                }
            }
            // 保险：如果遇到单独的 <div class="mermaid">，也还原
            if (node.classList.contains('mermaid')) {
                const src = node.dataset.mdDiagramSource || node.textContent || '';
                if (src.trim()) {
                    return '```mermaid\n' + src.trim() + '\n```\n\n';
                }
            }
            // 其他普通 div 正常递归
            return getChildrenMd();
        case 'hr':
            return '\n---\n\n';
        default:
            return getChildrenMd();
    }
}

/**
 * 将HTML转换为Markdown（整块）
 */
export function htmlToMarkdown(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html;

    let md = '';
    temp.childNodes.forEach(node => {
        md += htmlNodeToMarkdown(node);
    });

    // 清理多余空行
    md = md.replace(/\n{3,}/g, '\n\n');
    return md.trim() + '\n';
}

/**
 * 将HTML表格转换为Markdown表格
 */
export function convertHtmlTableToMarkdown(table) {
    const rows = Array.from(table.rows);
    if (!rows.length) return '';

    const mdRows = [];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const cells = Array.from(row.cells);

        const cellValues = cells.map(cell => {
            // 对单元格内部再走一遍 htmlNodeToMarkdown
            let s = '';
            cell.childNodes.forEach(n => {
                s += htmlNodeToMarkdown(n);
            });
            return s.trim().replace(/\n/g, '<br>');
        });

        if (i === 0) {
            // header
            mdRows.push('| ' + cellValues.join(' | ') + ' |');
            mdRows.push('| ' + cellValues.map(() => '---').join(' | ') + ' |');
        } else {
            mdRows.push('| ' + cellValues.join(' | ') + ' |');
        }
    }

    return mdRows.join('\n');
}

/**
 * 处理内容，将[[链接]]转换为可点击的跳转链接
 */
export function processContent(htmlContent) {
    if (typeof DOMPurify === 'undefined') {
        console.warn('DOMPurify is not available');
        return htmlContent;
    }
    
    const processed = htmlContent.replace(/\[\[([^\]]+)\]\]/g, '<span class="jump-link" style="color: var(--accent); font-weight: bold; cursor: pointer; text-decoration: none;" data-jump="$1">$1</span>');
    return DOMPurify.sanitize(processed, {
        ADD_TAGS: ['span'],
        ADD_ATTR: ['data-jump']
    });
}

/**
 * 获取单元格的干净文本（移除按钮等交互元素）
 */
export function getCleanText(cell) {
    const clone = cell.cloneNode(true);
    clone.querySelectorAll('.cell-expand-btn, .row-expand-btn, .hover-title').forEach(el => el.remove());
    return clone.textContent.trim();
}
