/**
 * 应用状态管理模块
 * 负责管理全局应用状态
 */

import { getViewsConfig, saveViewsConfig } from './api.js';
export const state = {
    originalPath: null,
    currentDir: '.',
    files: [],
    selectedIndex: -1,
    rawContents: {}, // {paneId: rawContent}
    histories: {}, // {paneId: []}
    historyIndices: {}, // {paneId: -1}
    currentFileItem: null,
    dirStack: [],
    folderStack: [],
    fileJumpStack: [],
    currentContext: 'dir',
    views: [ // 默认视图配置
        {id: 'original', titleTemplate: '原始文本：{filename}', suffix: '', keybind: 'a'},
        {id: 'analysis', titleTemplate: '分析文本：{filename}', suffix: '_analysis', keybind: 'd'}
    ],
    viewsMap: new Map(), // 视图ID到视图对象的快速索引，避免每次find遍历
    prompts: [], // 提示词列表 {name: string, content: string}
    selectedPrompt: null,
    themes: [], // 主题列表
    selectedTheme: null,
    themeHistories: {}, // {themeName: [{css: string, timestamp: number}]}
    layouts: [], // 视窗布局列表（列数、全屏行为等）
    selectedLayout: null,
    layoutHistories: {}, // {layoutName: [{config: object, timestamp: number}]}
    // HTML 页面布局模板列表（整页 HTML 骨架）
    htmlLayouts: [], // {name, description, createdAt, updatedAt}
    selectedHtmlLayout: null, // 当前选中的 HTML 布局（null 表示“默认 = 当前 index.html”）
    workflows: [], // 工作流列表
    events: [], // 事件列表
    eventItems: [], // 事件列表项 [{el: HTMLElement, name: string}]
    selectedEventIndex: -1, // 当前选中的事件索引
    panePaths: {}, // {paneId: path}
    scrollPositions: {}, // {paneId: scrollPosition} 用于保存每个视图的滚动位置
    viewAiStates: {}, // {viewId: boolean} 跟踪每个视图是否显示_ai文件，true表示显示_ai文件
    originalPanePaths: {}, // {viewId: originalPath} 保存每个视图的原始文件路径（用于切换回去）
    workflowExecutionState: null, // 当前工作流执行状态 {stepResults: {}, executedSteps: [], executingSteps: Set, isPaused: boolean, isCancelled: boolean, workflowName: string, options: object}
    keybinds: { // 快捷键配置
        w: 'w',
        s: 's',
        a: 'a',
        d: 'd',
        z: 'z', // 返回上一个文件
        enter: 'Enter',
        escape: 'Escape'
    },
    externalAiSyncEnabled: true, // 外部AI函数开启状态，默认开启
    isFirstCreateAfterReload: true // 页面刷新后的第一次创建操作标志，用于防止刷新后立即创建文件
};

// 全屏导航状态
export const fullscreenState = {
    currentRow: 0,
    currentCol: 0,
    currentTable: null,
    currentPaneId: null, // 当前编辑的视图ID
    fullscreenKeydownHandler: null,
    shouldAutoFocus: false // 是否应该自动聚焦（只有鼠标点击打开时才为true）
};

/**
 * 从view目录或localStorage加载状态
 */
export async function loadStateFromStorage() {
    await loadViewsFromPersistence();
    
    const savedKeybinds = localStorage.getItem('keybinds');
    if (savedKeybinds) state.keybinds = JSON.parse(savedKeybinds);
    
    const savedSelectedPrompt = localStorage.getItem('selectedPrompt');
    if (savedSelectedPrompt) {
        try {
            state.selectedPrompt = JSON.parse(savedSelectedPrompt);
        } catch (e) {
            console.error('Failed to parse saved selected prompt:', e);
            state.selectedPrompt = null;
        }
    }
    
    const savedThemes = localStorage.getItem('themes');
    if (savedThemes) {
        try {
            state.themes = JSON.parse(savedThemes);
        } catch (e) {
            console.error('Failed to parse saved themes:', e);
            state.themes = [];
        }
    }
    
    const savedSelectedTheme = localStorage.getItem('selectedTheme');
    if (savedSelectedTheme) {
        try {
            state.selectedTheme = JSON.parse(savedSelectedTheme);
        } catch (e) {
            console.error('Failed to parse saved selected theme:', e);
            state.selectedTheme = null;
        }
    }
    
    const savedThemeHistories = localStorage.getItem('themeHistories');
    if (savedThemeHistories) {
        try {
            state.themeHistories = JSON.parse(savedThemeHistories);
        } catch (e) {
            state.themeHistories = {};
        }
    }
    
    const savedLayouts = localStorage.getItem('layouts');
    if (savedLayouts) {
        try {
            state.layouts = JSON.parse(savedLayouts);
        } catch (e) {
            console.error('Failed to parse saved layouts:', e);
            state.layouts = [];
        }
    }
    
    const savedSelectedLayout = localStorage.getItem('selectedLayout');
    if (savedSelectedLayout) {
        try {
            state.selectedLayout = JSON.parse(savedSelectedLayout);
        } catch (e) {
            console.error('Failed to parse saved selected layout:', e);
            state.selectedLayout = null;
        }
    }
    
    const savedLayoutHistories = localStorage.getItem('layoutHistories');
    if (savedLayoutHistories) {
        try {
            state.layoutHistories = JSON.parse(savedLayoutHistories);
        } catch (e) {
            state.layoutHistories = {};
        }
    }
    
    const savedExternalAiSyncEnabled = localStorage.getItem('externalAiSyncEnabled');
    if (savedExternalAiSyncEnabled !== null) {
        try {
            state.externalAiSyncEnabled = JSON.parse(savedExternalAiSyncEnabled);
        } catch (e) {
            console.error('Failed to parse saved externalAiSyncEnabled:', e);
            state.externalAiSyncEnabled = true; // 默认开启
        }
    }

    // HTML 页面布局：只从 localStorage 恢复“当前选中项”，列表本身由管理面板按需从后端加载
    const savedSelectedHtmlLayout = localStorage.getItem('selectedHtmlLayout');
    if (savedSelectedHtmlLayout) {
        try {
            state.selectedHtmlLayout = JSON.parse(savedSelectedHtmlLayout);
        } catch (e) {
            console.error('Failed to parse saved selected html layout:', e);
            state.selectedHtmlLayout = null;
        }
    }
}

/**
 * 保存状态到localStorage
 */
export function saveStateToStorage() {
    localStorage.setItem('views', JSON.stringify(state.views));
    localStorage.setItem('keybinds', JSON.stringify(state.keybinds));
    if (state.selectedPrompt) {
        localStorage.setItem('selectedPrompt', JSON.stringify(state.selectedPrompt));
    }
    if (state.themes.length > 0) {
        localStorage.setItem('themes', JSON.stringify(state.themes));
    }
    if (state.selectedTheme) {
        localStorage.setItem('selectedTheme', JSON.stringify(state.selectedTheme));
    }
    if (Object.keys(state.themeHistories).length > 0) {
        localStorage.setItem('themeHistories', JSON.stringify(state.themeHistories));
    }
    if (state.layouts.length > 0) {
        localStorage.setItem('layouts', JSON.stringify(state.layouts));
    }
    if (state.selectedLayout) {
        localStorage.setItem('selectedLayout', JSON.stringify(state.selectedLayout));
    }
    if (Object.keys(state.layoutHistories).length > 0) {
        localStorage.setItem('layoutHistories', JSON.stringify(state.layoutHistories));
    }
    // 只持久化“当前选中的 HTML 布局”，列表由后端视为真源
    if (state.selectedHtmlLayout) {
        localStorage.setItem('selectedHtmlLayout', JSON.stringify(state.selectedHtmlLayout));
    } else {
        localStorage.removeItem('selectedHtmlLayout');
    }
    localStorage.setItem('externalAiSyncEnabled', JSON.stringify(state.externalAiSyncEnabled));
    
    persistViewsToFile();
}

async function loadViewsFromPersistence() {
    let loadedFromFile = false;
    
    try {
        const data = await getViewsConfig();
        if (data && Array.isArray(data.views)) {
            state.views = normalizeViews(data.views); // normalizeViews会自动更新viewsMap
            localStorage.setItem('views', JSON.stringify(state.views));
            loadedFromFile = true;
        }
        // 同步已删除视图到localStorage，供全屏面板历史记录使用
        if (data && Array.isArray(data.deletedViews)) {
            localStorage.setItem('deletedViews', JSON.stringify(data.deletedViews));
        }
    } catch (e) {
        console.warn('从view目录加载视图配置失败，将回退到localStorage:', e);
    }
    
    if (!loadedFromFile) {
        const savedViews = localStorage.getItem('views');
        if (savedViews) {
            try {
                state.views = normalizeViews(JSON.parse(savedViews)); // normalizeViews会自动更新viewsMap
            } catch (e) {
                console.error('Failed to parse saved views from localStorage:', e);
                state.views = normalizeViews(state.views); // normalizeViews会自动更新viewsMap
            }
        } else {
            state.views = normalizeViews(state.views); // normalizeViews会自动更新viewsMap
            localStorage.setItem('views', JSON.stringify(state.views));
        }
    }
}

function normalizeViews(views) {
    if (!Array.isArray(views)) return [];
    const normalized = views.map(view => {
        const normalizedView = { ...view };
        if (normalizedView.suffix === undefined || normalizedView.suffix === null) {
            normalizedView.suffix = '';
        }
        return normalizedView;
    });
    // 更新视图索引Map
    updateViewsMap(normalized);
    return normalized;
}

/**
 * 更新视图索引Map，用于快速查找视图（O(1)复杂度，而非O(n)的find遍历）
 */
export function updateViewsMap(views = state.views) {
    state.viewsMap.clear();
    views.forEach(view => {
        if (view && view.id) {
            state.viewsMap.set(view.id, view);
        }
    });
}

/**
 * 根据视图ID快速获取视图对象（使用Map索引，O(1)复杂度）
 * @param {string} viewId - 视图ID
 * @returns {object|undefined} 视图对象，如果不存在则返回undefined
 */
export function getViewById(viewId) {
    return state.viewsMap.get(viewId);
}

function persistViewsToFile() {
    let deletedViews = [];
    try {
        const savedDeleted = localStorage.getItem('deletedViews');
        if (savedDeleted) {
            const parsed = JSON.parse(savedDeleted);
            if (Array.isArray(parsed)) deletedViews = parsed;
        }
    } catch (e) {
        // ignore parse errors, use empty
    }
    
    saveViewsConfig(state.views, deletedViews).catch(err => {
        console.error('保存视图配置到view目录失败:', err);
    });
}
