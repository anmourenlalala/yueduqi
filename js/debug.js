/**
 * 调试工具模块
 * 用于检查模块加载和DOM状态
 */

export function checkModuleStatus() {
    const status = {
        modules: {},
        dom: {},
        functions: {}
    };
    
    // 检查关键DOM元素
    status.dom = {
        btnPrompt: !!document.getElementById('btn-prompt'),
        btnSettings: !!document.getElementById('btn-settings'),
        btnTheme: !!document.getElementById('btn-theme'),
        btnLayout: !!document.getElementById('btn-layout'),
        btnCopy: !!document.getElementById('btn-copy'),
        settingsModal: !!document.getElementById('settings-modal'),
        promptPanel: !!document.getElementById('prompt-panel'),
        themePanel: !!document.getElementById('theme-panel'),
        layoutPanel: !!document.getElementById('layout-panel')
    };
    
    // 检查关键函数
    status.functions = {
        initEventBindings: typeof window.initEventBindings !== 'undefined',
        loadDir: typeof window.loadDir !== 'undefined',
        copyContent: typeof window.copyContent !== 'undefined',
        handlePaste: typeof window.handlePaste !== 'undefined',
        renderThemesList: typeof window.renderThemesList !== 'undefined',
        renderPromptsList: typeof window.renderPromptsList !== 'undefined',
        renderLayoutsList: typeof window.renderLayoutsList !== 'undefined'
    };
    
    // 检查state
    status.state = typeof window.state !== 'undefined';
    
    console.log('=== 模块状态检查 ===');
    console.log('DOM元素:', status.dom);
    console.log('函数:', status.functions);
    console.log('State:', status.state);
    console.log('==================');
    
    return status;
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.checkModuleStatus = checkModuleStatus;
}








