/**
 * 使用统计面板主控制器
 * 整合所有模块，管理面板的显示和交互
 */

import { queryAllUsage } from './logQuery.js';
import { scanProjectFiles, mergeUsageData } from './fileSystemScanner.js';
import { getUsageConfig, saveUsageConfig, initAutoScan } from './usageConfig.js';
import { renderUsageList, renderStatsSummary, renderUsageDetail, showKeywordStatsModal } from './usageDisplay.js';
import { state } from '../../core/state.js';

let currentData = {
    workflows: [],
    events: [],
    views: [],
    source: 'log'
};

let currentFilter = 'all';
let currentSearchTerm = '';
let selectedItem = null;
let autoScanController = null;

/**
 * 初始化使用统计面板
 */
export function initUsagePanel() {
    bindPanelEvents();
    loadUsageData();
    initAutoScanFeature();
}

/**
 * 绑定面板事件
 */
function bindPanelEvents() {
    // 打开/关闭面板
    const openBtn = document.getElementById('open-usage-panel-btn');
    const closeBtn = document.getElementById('close-usage-panel');
    const panel = document.getElementById('usage-panel');
    
    if (openBtn) {
        openBtn.addEventListener('click', () => {
            // 先关闭设置面板，避免遮挡
            const settingsModal = document.getElementById('settings-modal');
            if (settingsModal) {
                settingsModal.style.display = 'none';
            }

            if (panel) {
                panel.style.display = 'flex';
                panel.focus();
                loadUsageData();
            }
        });
    }
    
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            if (panel) {
                panel.style.display = 'none';
            }
        });
    }

    // ESC键关闭面板
    if (panel) {
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                panel.style.display = 'none';
            }
        });
    }
    
    // 搜索框
    const searchInput = document.getElementById('usage-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearchTerm = e.target.value;
            updateDisplay();
        });
    }
    
    // 过滤标签
    const filterTabs = document.querySelectorAll('.filter-tab');
    filterTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            filterTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            updateDisplay();
        });
    });
    
    // 刷新按钮
    const refreshBtn = document.getElementById('refresh-usage-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadUsageData();
        });
    }
    
    // 扫描文件系统按钮
    const scanBtn = document.getElementById('scan-filesystem-btn');
    if (scanBtn) {
        scanBtn.addEventListener('click', async () => {
            await scanFilesystem();
        });
    }
    
    // 导出按钮
    const exportBtn = document.getElementById('export-usage-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            exportUsageData();
        });
    }
    
    // 暴露全局函数供详情显示使用
    window.showUsageDetail = (item) => {
        selectedItem = item;
        renderUsageDetail(item);
    };
    
    // 暴露关键字统计函数
    window.showKeywordStats = (type, name) => {
        showKeywordStatsModal(type, name);
    };
    
    // 暴露获取选中项的函数
    window.getSelectedUsageItem = () => {
        return selectedItem;
    };
}

/**
 * 加载使用数据
 */
async function loadUsageData() {
    try {
        const refreshBtn = document.getElementById('refresh-usage-btn');
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = '<span>⏳</span><span>加载中...</span>';
        }
        
        // 从日志读取数据
        const logData = await queryAllUsage({});
        currentData = logData;
        
        updateDisplay();
        
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = '<span>🔄</span><span>刷新</span>';
        }
    } catch (error) {
        console.error('加载使用数据失败:', error);
        alert('加载数据失败: ' + error.message);
    }
}

/**
 * 扫描文件系统
 */
async function scanFilesystem() {
    try {
        const scanBtn = document.getElementById('scan-filesystem-btn');
        if (scanBtn) {
            scanBtn.disabled = true;
            scanBtn.innerHTML = '<span>⏳</span><span>扫描中...</span>';
        }
        
        // 获取项目根目录（从当前文件路径推断）
        let projectRoot = '';
        if (state.originalPath) {
            const lastSep = Math.max(state.originalPath.lastIndexOf('\\'), state.originalPath.lastIndexOf('/'));
            projectRoot = lastSep >= 0 ? state.originalPath.substring(0, lastSep) : state.originalPath;
        }
        
        if (!projectRoot) {
            throw new Error('请先选择一个文件以确定项目根目录');
        }
        
        // 扫描文件系统
        const scanData = await scanProjectFiles(projectRoot);
        
        // 合并数据
        currentData = mergeUsageData(currentData, scanData);
        
        updateDisplay();
        
        if (scanBtn) {
            scanBtn.disabled = false;
            scanBtn.innerHTML = '<span>🔍</span><span>扫描文件系统</span>';
        }
        
        alert('扫描完成！');
    } catch (error) {
        console.error('扫描文件系统失败:', error);
        alert('扫描失败: ' + error.message);
        
        const scanBtn = document.getElementById('scan-filesystem-btn');
        if (scanBtn) {
            scanBtn.disabled = false;
            scanBtn.innerHTML = '<span>🔍</span><span>扫描文件系统</span>';
        }
    }
}

/**
 * 更新显示
 */
function updateDisplay() {
    renderStatsSummary(currentData, selectedItem);
    renderUsageList(currentData, currentFilter, currentSearchTerm);
    
    if (selectedItem) {
        renderUsageDetail(selectedItem);
    }
}

/**
 * 导出使用数据
 */
function exportUsageData() {
    try {
        const dataStr = JSON.stringify(currentData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `usage-stats-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('导出数据失败:', error);
        alert('导出失败: ' + error.message);
    }
}

/**
 * 初始化自动扫描功能
 */
function initAutoScanFeature() {
    // 自动扫描回调
    const scanCallback = async () => {
        try {
            let projectRoot = '';
            if (state.originalPath) {
                const lastSep = Math.max(state.originalPath.lastIndexOf('\\'), state.originalPath.lastIndexOf('/'));
                projectRoot = lastSep >= 0 ? state.originalPath.substring(0, lastSep) : state.originalPath;
            }
            
            if (!projectRoot) {
                return; // 没有项目路径，跳过扫描
            }
            
            const scanData = await scanProjectFiles(projectRoot);
            currentData = mergeUsageData(currentData, scanData);
            
            // 如果面板是打开的，更新显示
            const panel = document.getElementById('usage-panel');
            if (panel && panel.style.display === 'flex') {
                updateDisplay();
            }
        } catch (error) {
            console.error('自动扫描失败:', error);
        }
    };
    
    // 初始化自动扫描
    autoScanController = initAutoScan(scanCallback);
}

/**
 * 更新自动扫描配置
 */
export async function updateAutoScanConfig(scanEnabled, scanInterval) {
    try {
        await saveUsageConfig({ scanEnabled, scanInterval });
        
        // 更新自动扫描
        if (autoScanController) {
            if (autoScanController.updateEnabled) {
                autoScanController.updateEnabled(scanEnabled);
            }
            if (autoScanController.updateInterval && scanInterval) {
                autoScanController.updateInterval(scanInterval);
            }
        }
    } catch (error) {
        console.error('更新自动扫描配置失败:', error);
        throw error;
    }
}

