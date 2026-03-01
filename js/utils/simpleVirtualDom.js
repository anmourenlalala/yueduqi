/**
 * 一个轻量级的虚拟DOM实现，用来替代直接的 innerHTML 重绘，
 * 目标是：
 *  - 减少整块 DOM 替换，尽量复用节点（对手机端更友好）
 *  - 不引入外部框架，在现有架构上平滑接入
 *
 * 使用方式：
 *   import { renderHtmlWithVDOM } from '../utils/simpleVirtualDom.js';
 *   renderHtmlWithVDOM(containerEl, safeHtmlString);
 */

const containerVTreeMap = new WeakMap();

/**
 * 将 HTML 字符串转换为虚拟节点数组
 * @param {string} html
 * @returns {Array} vtree
 */
function createVTreeFromHTML(html) {
    const template = document.createElement('template');
    template.innerHTML = html || '';
    const fragment = template.content;
    const nodes = Array.from(fragment.childNodes);
    return nodes.map(nodeToVNode);
}

/**
 * 将真实 DOM 节点转换为虚拟节点
 * 这里只支持 element/text 两种节点类型，足够覆盖当前 Markdown 渲染场景
 * @param {Node} node
 * @returns {Object}
 */
function nodeToVNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
        return {
            type: 'text',
            text: node.textContent || ''
        };
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
        const el = /** @type {HTMLElement} */ (node);
        const props = {};
        for (const attr of Array.from(el.attributes)) {
            props[attr.name] = attr.value;
        }

        const children = Array.from(el.childNodes).map(nodeToVNode);

        // key 的策略：
        //  - 优先使用 id
        //  - 其次 data-key
        //  - 否则由外层按 index 兜底
        const key = el.id || el.getAttribute('data-key') || null;

        return {
            type: 'element',
            tag: el.tagName.toLowerCase(),
            props,
            children,
            key
        };
    }

    // 其他类型节点（注释等）直接忽略
    return {
        type: 'text',
        text: ''
    };
}

/**
 * 根据虚拟节点创建真实 DOM 节点
 * @param {Object} vnode
 * @returns {Node}
 */
function createRealNode(vnode) {
    if (!vnode) return document.createTextNode('');

    if (vnode.type === 'text') {
        return document.createTextNode(vnode.text || '');
    }

    const el = document.createElement(vnode.tag);
    if (vnode.props) {
        for (const [name, value] of Object.entries(vnode.props)) {
            try {
                el.setAttribute(name, value);
            } catch (e) {
                // 某些非法属性直接忽略，避免在移动端抛错
            }
        }
    }
    if (Array.isArray(vnode.children)) {
        for (const child of vnode.children) {
            el.appendChild(createRealNode(child));
        }
    }
    return el;
}

/**
 * 对比并更新单个节点
 * @param {Node|null} realNode 当前真实 DOM 节点
 * @param {Object|null} oldVNode 旧虚拟节点
 * @param {Object|null} newVNode 新虚拟节点
 * @returns {Node|null} 更新后的真实 DOM 节点
 */
function patchNode(realNode, oldVNode, newVNode) {
    // 新节点不存在 -> 删除
    if (!newVNode) {
        if (realNode && realNode.parentNode) {
            realNode.parentNode.removeChild(realNode);
        }
        return null;
    }

    // 旧节点不存在 -> 创建
    if (!oldVNode || !realNode) {
        return createRealNode(newVNode);
    }

    // 类型变化，或元素标签变化 -> 替换
    if (oldVNode.type !== newVNode.type ||
        (newVNode.type === 'element' && oldVNode.tag !== newVNode.tag)) {
        const newReal = createRealNode(newVNode);
        if (realNode.parentNode) {
            realNode.parentNode.replaceChild(newReal, realNode);
        }
        return newReal;
    }

    // 文本节点：只更新 textContent
    if (newVNode.type === 'text') {
        if (realNode.textContent !== newVNode.text) {
            realNode.textContent = newVNode.text;
        }
        return realNode;
    }

    // 元素节点：更新属性 + 递归子节点
    const el = /** @type {HTMLElement} */ (realNode);

    // 更新属性（先设置/更新，再移除多余）
    const oldProps = oldVNode.props || {};
    const newProps = newVNode.props || {};

    for (const [name, value] of Object.entries(newProps)) {
        if (oldProps[name] !== value) {
            try {
                el.setAttribute(name, value);
            } catch (e) {
                // 忽略非法属性
            }
        }
    }

    for (const name of Object.keys(oldProps)) {
        if (!(name in newProps)) {
            el.removeAttribute(name);
        }
    }

    // 子节点 diff：为了简单和稳定性，使用 index-based diff
    // 当前 Markdown 内容以块为主，index diff 已经能大幅减少整树替换
    const oldChildren = oldVNode.children || [];
    const newChildren = newVNode.children || [];

    const maxLen = Math.max(oldChildren.length, newChildren.length);
    for (let i = 0; i < maxLen; i++) {
        const oldChildVNode = oldChildren[i] || null;
        const newChildVNode = newChildren[i] || null;
        const realChild = el.childNodes[i] || null;

        if (!newChildVNode && realChild) {
            el.removeChild(realChild);
            continue;
        }

        if (!realChild) {
            if (newChildVNode) {
                el.appendChild(createRealNode(newChildVNode));
            }
            continue;
        }

        const patchedChild = patchNode(realChild, oldChildVNode, newChildVNode);
        if (!patchedChild && el.childNodes[i]) {
            el.removeChild(el.childNodes[i]);
        }
    }

    return el;
}

/**
 * 使用虚拟DOM渲染 HTML 字符串到容器
 * 注意：调用前的 HTML 必须已经是安全的（例如由 DOMPurify 处理过）
 * @param {HTMLElement} container
 * @param {string} safeHtml
 */
export function renderHtmlWithVDOM(container, safeHtml) {
    if (!container) return;

    const oldVTree = containerVTreeMap.get(container) || [];
    const newVTree = createVTreeFromHTML(safeHtml);

    const childNodes = Array.from(container.childNodes);
    const maxLen = Math.max(oldVTree.length, newVTree.length);

    // 通过逐个 patch，尽量复用现有节点，减少整块 innerHTML 替换
    for (let i = 0; i < maxLen; i++) {
        const oldVNode = oldVTree[i] || null;
        const newVNode = newVTree[i] || null;
        const realChild = childNodes[i] || null;

        if (!newVNode) {
            if (realChild && realChild.parentNode === container) {
                container.removeChild(realChild);
            }
            continue;
        }

        if (!realChild) {
            container.appendChild(createRealNode(newVNode));
            continue;
        }

        const patched = patchNode(realChild, oldVNode, newVNode);
        if (!patched && container.childNodes[i]) {
            container.removeChild(container.childNodes[i]);
        }
    }

    containerVTreeMap.set(container, newVTree);
}








