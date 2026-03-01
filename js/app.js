/**
 * 主应用入口
 * 负责初始化应用和整合所有模块
 */

import { state, loadStateFromStorage, saveStateToStorage } from './core/state.js';
import { initializeHistories } from './utils/history.js';
import { renderViewerGrid, renderPasteTargets, renderSettings } from './modules/viewManager.js';
import { loadDir } from './modules/fileManager.js';
import { getDirectory } from './core/api.js';
import { initEventBindings } from './modules/eventBindings.js';
import { loadFileViews } from './modules/editor.js';
import { selectFileByPath } from './modules/editor.js';
import { initContextMenu } from './modules/contextMenu.js';
import { updatePromptDisplay } from './modules/promptManager.js';
import { initScrollbarController } from './utils/scrollbarController.js';
import { loadThemes, applyThemeFromState } from './modules/themeManager.js';
import { initAccessControl } from './utils/accessControl.js';

// 暴露state到全局，供其他脚本使用
if (typeof window !== 'undefined') {
    window.state = state;
}

/**
 * 调整导航栏按钮字体大小，确保按钮内容不换行
 */
export function adjustHeaderButtonFontSizes() {
    const headerActions = document.querySelector('.header-actions');
    if (!headerActions) return;
    
    const buttons = headerActions.querySelectorAll('.btn');
    
    buttons.forEach(button => {
        // 跳过仅图标按钮
        if (button.classList.contains('btn-icon-only')) {
            return;
        }
        
        // 重置字体大小
        button.style.fontSize = '';
        const textSpans = button.querySelectorAll('span');
        textSpans.forEach(span => {
            span.style.fontSize = '';
        });
        
        // 获取按钮的原始尺寸
        const originalFontSize = window.getComputedStyle(button).fontSize;
        const fontSize = parseFloat(originalFontSize);
        
        // 获取按钮的scrollHeight和offsetHeight
        // scrollHeight > offsetHeight 说明内容溢出（换行）
        const scrollHeight = button.scrollHeight;
        const offsetHeight = button.offsetHeight;
        const lineHeight = parseFloat(window.getComputedStyle(button).lineHeight) || fontSize * 1.2;
        
        // 如果按钮内容换行（scrollHeight > offsetHeight 或高度超过单行），需要缩小字体
        if (scrollHeight > offsetHeight || offsetHeight > lineHeight * 1.5) {
            let currentFontSize = fontSize;
            let attempts = 0;
            const maxAttempts = 30;
            const minFontSize = 10; // 最小字体大小
            
            // 逐步缩小字体直到不换行
            while (currentFontSize > minFontSize && attempts < maxAttempts) {
                currentFontSize -= 0.5;
                button.style.fontSize = currentFontSize + 'px';
                
                // 强制重排以获取新的高度
                void button.offsetHeight;
                
                const newScrollHeight = button.scrollHeight;
                const newOffsetHeight = button.offsetHeight;
                const newLineHeight = parseFloat(window.getComputedStyle(button).lineHeight) || currentFontSize * 1.2;
                
                // 如果不再换行，停止
                if (newScrollHeight <= newOffsetHeight && newOffsetHeight <= newLineHeight * 1.5) {
                    break;
                }
                
                attempts++;
            }
            
            // 如果还是换行，使用最小字体并添加省略号
            void button.offsetHeight;
            const finalScrollHeight = button.scrollHeight;
            const finalOffsetHeight = button.offsetHeight;
            const finalLineHeight = parseFloat(window.getComputedStyle(button).lineHeight) || currentFontSize * 1.2;
            
            if (finalScrollHeight > finalOffsetHeight || finalOffsetHeight > finalLineHeight * 1.5) {
                button.style.fontSize = minFontSize + 'px';
                // 确保文本不换行
                button.style.whiteSpace = 'nowrap';
                button.style.overflow = 'hidden';
                button.style.textOverflow = 'ellipsis';
            }
        }
    });
}

/**
 * 初始化按钮字体大小调整
 */
function initButtonFontSizeAdjustment() {
    // 页面加载完成后调整
    setTimeout(() => {
        adjustHeaderButtonFontSizes();
    }, 100);
    
    // 窗口大小改变时调整
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            adjustHeaderButtonFontSizes();
        }, 100);
    });
    
    // 主题应用后调整（监听DOM变化）
    const observer = new MutationObserver(() => {
        setTimeout(() => {
            adjustHeaderButtonFontSizes();
        }, 200);
    });
    
    const headerContainer = document.querySelector('.header-container');
    if (headerContainer) {
        observer.observe(headerContainer, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class']
        });
    }
    
    // 监听主题样式变化
    const themeObserver = new MutationObserver(() => {
        setTimeout(() => {
            adjustHeaderButtonFontSizes();
        }, 300);
    });
    
    const themeStyle = document.getElementById('dynamic-theme-style');
    if (themeStyle) {
        themeObserver.observe(themeStyle, {
            attributes: true,
            attributeFilter: ['id']
        });
    }
    
    // 监听head中的样式变化（主题可能被添加或移除）
    const headObserver = new MutationObserver(() => {
        setTimeout(() => {
            adjustHeaderButtonFontSizes();
        }, 300);
    });
    
    if (document.head) {
        headObserver.observe(document.head, {
            childList: true,
            subtree: false
        });
    }
}

/**
 * 初始化应用
 */
export async function initApp() {
    // 加载状态
    await loadStateFromStorage();
    
    // 恢复主题设置（日间/夜间）
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
    }
    
    // 加载主题列表
    await loadThemes();
    
    // 应用已选中的主题（如果有）
    await applyThemeFromState();
    
    // 初始化历史记录
    initializeHistories();
    
    // 初始化事件绑定
    initEventBindings();
    
    // 初始化右键菜单
    initContextMenu();
    
    // 初始化滚动条控制
    initScrollbarController();
    
    // 初始化访问控制（检测是否为本地访问）
    initAccessControl();
    
    // 暴露字体调整函数到全局
    if (typeof window !== 'undefined') {
        window.adjustHeaderButtonFontSizes = adjustHeaderButtonFontSizes;
    }
    
    // 初始化按钮字体大小调整
    initButtonFontSizeAdjustment();
    
    // 渲染视图网格
    renderViewerGrid();
    
    // 渲染粘贴目标
    renderPasteTargets();
    
    // 渲染设置
    renderSettings();
    
    // 更新提示词显示（根据加载的状态决定是否显示）
    updatePromptDisplay();
    
    // 恢复上次打开的目录
    const lastOpenedDir = localStorage.getItem('lastOpenedDir');
    if (lastOpenedDir) {
        try {
            // 尝试加载上次打开的目录
            await loadDir(lastOpenedDir);
        } catch (error) {
            // 如果路径不存在或无效，获取当前根路径并保存
            console.log('上次打开的目录不存在，使用当前根路径:', error);
            try {
                const rootData = await getDirectory('.');
                const rootPath = rootData.path;
                localStorage.setItem('lastOpenedDir', rootPath);
                await loadDir(rootPath);
            } catch (rootError) {
                // 如果获取根路径也失败，使用默认路径
                console.log('获取根路径失败，使用默认路径:', rootError);
                await loadDir('.');
            }
        }
    } else {
        // 首次启用，获取当前根路径并保存
        try {
            const rootData = await getDirectory('.');
            const rootPath = rootData.path;
            localStorage.setItem('lastOpenedDir', rootPath);
            await loadDir(rootPath);
        } catch (error) {
            console.log('获取根路径失败，使用默认路径:', error);
            await loadDir('.');
        }
    }
    
    // 恢复上次打开的文件
    const lastOpenedFile = localStorage.getItem('lastOpenedFile');
    if (lastOpenedFile && selectFileByPath) {
        // 延迟一下，确保目录已加载
        setTimeout(() => {
            selectFileByPath(lastOpenedFile).catch(err => {
                console.log('无法恢复上次打开的文件，可能文件已不存在:', err);
            });
        }, 500);
    }
    
    // 定期保存状态
    setInterval(() => {
        saveStateToStorage();
    }, 30000); // 每30秒保存一次
    
    // 初始化拖拽分离功能
    try {
        const { initDragSeparator, notifySeparatedWindowsFileChange } = await import('./modules/dragSeparator/index.js');
        initDragSeparator();
        // 暴露通知函数到全局
        if (typeof window !== 'undefined') {
            window.notifySeparatedWindowsFileChange = notifySeparatedWindowsFileChange;
        }
    } catch (err) {
        console.warn('拖拽分离功能初始化失败:', err);
    }
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
