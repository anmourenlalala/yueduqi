/**
 * 滚动条显示控制模块
 * 滚动条始终显示，不隐藏
 */

/**
 * 初始化滚动条控制
 * 现在滚动条始终显示，不需要JS控制
 */
export function initScrollbarController() {
    // 滚动条始终显示，不需要特殊处理
    console.log('滚动条控制已初始化（始终显示）');
}

/**
 * 清理元素的事件监听（兼容性函数）
 */
export function cleanupScrollbarControl(element) {
    // 不需要清理，因为滚动条始终显示
    if (element) {
        element.classList.remove('scrollbar-visible', 'scrollbar-hidden');
    }
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.initScrollbarController = initScrollbarController;
    window.cleanupScrollbarControl = cleanupScrollbarControl;
}

