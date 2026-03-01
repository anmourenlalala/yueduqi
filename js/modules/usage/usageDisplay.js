/**
 * 使用统计数据显示模块
 * 负责渲染统计数据到UI
 */

import { getKeywordStatsByItem, scanAndProcessNewFeedbackFiles } from './keywordStats.js';

/**
 * 渲染使用统计列表
 * @param {object} data - 统计数据 {workflows, events, views}
 * @param {string} filter - 过滤类型 'all' | 'workflow' | 'event' | 'view'
 * @param {string} searchTerm - 搜索关键词
 */
export function renderUsageList(data, filter = 'all', searchTerm = '') {
    const listEl = document.getElementById('usage-list');
    if (!listEl) return;
    
    listEl.innerHTML = '';
    
    let items = [];
    
    // 根据过滤类型添加项目
    if (filter === 'all' || filter === 'workflow') {
        items.push(...(data.workflows || []).map(item => ({
            ...item,
            type: 'workflow',
            name: item.workflowName,
            displayName: `工作流: ${item.workflowName}`
        })));
    }
    
    if (filter === 'all' || filter === 'event') {
        items.push(...(data.events || []).map(item => ({
            ...item,
            type: 'event',
            name: item.eventName,
            displayName: `事件: ${item.eventName}`
        })));
    }
    
    if (filter === 'all' || filter === 'view') {
        items.push(...(data.views || []).map(item => ({
            ...item,
            type: 'view',
            name: item.viewId,
            displayName: `视图: ${item.viewId}`
        })));
    }
    
    // 搜索过滤
    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        items = items.filter(item => 
            item.name.toLowerCase().includes(term) ||
            item.displayName.toLowerCase().includes(term)
        );
    }
    
    // 按使用次数排序
    items.sort((a, b) => b.count - a.count);
    
    if (items.length === 0) {
        listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">没有找到匹配的记录</div>';
        return;
    }
    
    // 渲染列表项
    items.forEach((item, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'usage-list-item';
        itemEl.style.cssText = `
            padding: 12px;
            margin-bottom: 8px;
            background: var(--bg-tertiary);
            border: 1px solid var(--border);
            border-radius: var(--border-radius);
            cursor: pointer;
            transition: all 0.2s;
        `;
        
        itemEl.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="flex: 1;">
                    <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">
                        ${item.displayName}
                    </div>
                    <div style="font-size: 12px; color: var(--text-muted);">
                        使用次数: ${item.count} | 
                        ${item.type === 'event' ? `目录执行: ${item.directoryCount || 0} | 单文件执行: ${item.fileCount || 0} | ` : ''}
                        首次使用: ${item.firstUsed ? formatDate(item.firstUsed) : '未知'} | 
                        最后使用: ${item.lastUsed ? formatDate(item.lastUsed) : '未知'}
                    </div>
                </div>
                <div style="margin-left: 12px; font-size: 20px;">
                    ${getTypeIcon(item.type)}
                </div>
            </div>
        `;
        
        itemEl.onmouseenter = () => {
            itemEl.style.background = 'var(--bg-secondary)';
            itemEl.style.borderColor = 'var(--accent-blue)';
        };
        
        itemEl.onmouseleave = () => {
            itemEl.style.background = 'var(--bg-tertiary)';
            itemEl.style.borderColor = 'var(--border)';
        };
        
        itemEl.onclick = () => {
            // 移除其他项的选中状态
            listEl.querySelectorAll('.usage-list-item').forEach(el => {
                el.style.background = 'var(--bg-tertiary)';
                el.style.borderColor = 'var(--border)';
            });
            
            // 选中当前项
            itemEl.style.background = 'var(--accent-bg)';
            itemEl.style.borderColor = 'var(--accent-blue)';
            
            // 触发详情显示事件
            if (window.showUsageDetail) {
                window.showUsageDetail(item);
            }
        };
        
        // 添加右键菜单或双击显示关键字统计
        itemEl.ondblclick = () => {
            if (window.showKeywordStats) {
                window.showKeywordStats(item.type, item.name);
            }
        };
        
        listEl.appendChild(itemEl);
    });
}

/**
 * 渲染统计摘要
 * @param {object} data - 统计数据
 * @param {object} selectedItem - 当前选中的项
 */
export function renderStatsSummary(data, selectedItem = null) {
    const summaryEl = document.getElementById('usage-stats-summary');
    if (!summaryEl) return;
    
    const workflowCount = (data.workflows || []).length;
    const eventCount = (data.events || []).length;
    const viewCount = (data.views || []).length;
    
    const totalWorkflowUsage = (data.workflows || []).reduce((sum, w) => sum + w.count, 0);
    const totalEventUsage = (data.events || []).reduce((sum, e) => sum + e.count, 0);
    const totalViewUsage = (data.views || []).reduce((sum, v) => sum + v.count, 0);
    
    // 根据选中项决定点击行为
    const getKeywordStatsHandler = (cardType) => {
        return `window.showKeywordStatsFromCard('${cardType}');`;
    };
    
    summaryEl.innerHTML = `
        <div class="stats-card" data-type="workflow" style="padding: 16px; background: var(--bg-tertiary); border-radius: var(--border-radius); border: 1px solid var(--border); cursor: pointer; transition: all 0.2s;" onmouseenter="this.style.background='var(--bg-secondary)'; this.style.borderColor='var(--accent-blue)';" onmouseleave="this.style.background='var(--bg-tertiary)'; this.style.borderColor='var(--border)';" onclick="${getKeywordStatsHandler('workflow')}">
            <div style="font-size: 24px; margin-bottom: 8px;">📋</div>
            <div style="font-size: 20px; font-weight: 600; color: var(--text-primary);">${workflowCount}</div>
            <div style="font-size: 12px; color: var(--text-muted);">工作流</div>
            <div style="font-size: 14px; color: var(--accent-blue); margin-top: 8px;">总使用: ${totalWorkflowUsage}</div>
            <div style="font-size: 12px; color: var(--accent-green); margin-top: 4px; cursor: pointer;">🔍 查看关键字统计</div>
        </div>
        <div class="stats-card" data-type="event" style="padding: 16px; background: var(--bg-tertiary); border-radius: var(--border-radius); border: 1px solid var(--border); cursor: pointer; transition: all 0.2s;" onmouseenter="this.style.background='var(--bg-secondary)'; this.style.borderColor='var(--accent-blue)';" onmouseleave="this.style.background='var(--bg-tertiary)'; this.style.borderColor='var(--border)';" onclick="${getKeywordStatsHandler('event')}">
            <div style="font-size: 24px; margin-bottom: 8px;">⚡</div>
            <div style="font-size: 20px; font-weight: 600; color: var(--text-primary);">${eventCount}</div>
            <div style="font-size: 12px; color: var(--text-muted);">事件</div>
            <div style="font-size: 14px; color: var(--accent-blue); margin-top: 8px;">总使用: ${totalEventUsage}</div>
            <div style="font-size: 12px; color: var(--accent-green); margin-top: 4px; cursor: pointer;">🔍 查看关键字统计</div>
        </div>
        <div class="stats-card" data-type="view" style="padding: 16px; background: var(--bg-tertiary); border-radius: var(--border-radius); border: 1px solid var(--border); cursor: pointer; transition: all 0.2s;" onmouseenter="this.style.background='var(--bg-secondary)'; this.style.borderColor='var(--accent-blue)';" onmouseleave="this.style.background='var(--bg-tertiary)'; this.style.borderColor='var(--border)';" onclick="${getKeywordStatsHandler('view')}">
            <div style="font-size: 24px; margin-bottom: 8px;">👁️</div>
            <div style="font-size: 20px; font-weight: 600; color: var(--text-primary);">${viewCount}</div>
            <div style="font-size: 12px; color: var(--text-muted);">视图</div>
            <div style="font-size: 14px; color: var(--accent-blue); margin-top: 8px;">总使用: ${totalViewUsage}</div>
            <div style="font-size: 12px; color: var(--accent-green); margin-top: 4px; cursor: pointer;">🔍 查看关键字统计</div>
        </div>
    `;
}

/**
 * 从统计卡片显示关键字统计（带筛选功能）
 * @param {string} cardType - 卡片类型 'workflow' | 'event' | 'view'
 */
function showKeywordStatsFromCard(cardType) {
    // 获取当前选中的项
    const selectedItem = window.getSelectedUsageItem ? window.getSelectedUsageItem() : null;
    
    if (selectedItem) {
        // 如果有选中项，显示该选中项的关键字统计，并添加筛选功能
        showKeywordStatsModal(selectedItem.type, selectedItem.name, cardType);
    } else {
        // 如果没有选中项，提示用户先选择
        if (confirm('请先从左侧列表选择一个工作流/事件/视图，然后查看其关键字统计。\n\n点击"确定"查看该类型的所有关键字统计。')) {
            showKeywordStatsModal(cardType, null, cardType);
        }
    }
}

// 暴露全局函数
if (typeof window !== 'undefined') {
    window.showKeywordStatsFromCard = showKeywordStatsFromCard;
}

/**
 * 渲染使用详情
 * @param {object} item - 使用记录项
 */
export function renderUsageDetail(item) {
    const detailEl = document.getElementById('usage-details');
    if (!detailEl) return;
    
    if (!item) {
        detailEl.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);"><p>请从左侧列表选择一项查看详情</p></div>';
        return;
    }
    
    let detailHTML = '';
    
    if (item.type === 'workflow') {
        detailHTML = renderWorkflowDetail(item);
    } else if (item.type === 'event') {
        detailHTML = renderEventDetail(item);
    } else if (item.type === 'view') {
        detailHTML = renderViewDetail(item);
    }
    
    detailEl.innerHTML = detailHTML;
}

function renderWorkflowDetail(item) {
    return `
        <div class="usage-detail-container">
            <div class="detail-header" style="margin-bottom: 24px;">
                <h3 style="font-size: 20px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px;">
                    📋 工作流: ${item.workflowName}
                </h3>
                <div style="display: flex; gap: 16px; font-size: 14px; color: var(--text-muted); align-items: center; flex-wrap: wrap;">
                    <span>使用次数: <strong style="color: var(--accent-blue);">${item.count}</strong></span>
                    <span>首次使用: ${item.firstUsed ? formatDate(item.firstUsed) : '未知'}</span>
                    <span>最后使用: ${item.lastUsed ? formatDate(item.lastUsed) : '未知'}</span>
                    <button onclick="window.showKeywordStats('workflow', '${item.workflowName}');" style="background: var(--accent-green); color: white; border: none; border-radius: var(--border-radius); padding: 6px 12px; cursor: pointer; font-size: 12px; margin-left: auto;" onmouseenter="this.style.opacity='0.8';" onmouseleave="this.style.opacity='1';">
                        🔑 查看关键字统计
                    </button>
                </div>
            </div>
            <div class="detail-records">
                <h4 style="font-size: 16px; font-weight: 600; margin-bottom: 12px; color: var(--text-primary);">使用记录</h4>
                <div style="max-height: 400px; overflow-y: auto;">
                    ${renderRecords(item.records || [])}
                </div>
            </div>
        </div>
    `;
}

function renderEventDetail(item) {
    // 计算目录相关统计
    const directoryCount = item.directoryCount || 0;
    const fileCount = item.fileCount || 0;
    const totalFilesProcessed = item.totalFilesProcessed || 0;
    const totalStepsExecuted = item.totalStepsExecuted || 0;
    
    return `
        <div class="usage-detail-container">
            <div class="detail-header" style="margin-bottom: 24px;">
                <h3 style="font-size: 20px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px;">
                    ⚡ 事件: ${item.eventName}
                </h3>
                <div style="display: flex; flex-wrap: wrap; gap: 16px; font-size: 14px; color: var(--text-muted); margin-bottom: 12px; align-items: center;">
                    <span>关联工作流: <strong style="color: var(--accent-blue);">${item.workflowName || '未知'}</strong></span>
                    <span>总使用次数: <strong style="color: var(--accent-blue);">${item.count}</strong></span>
                    <span>目录执行: <strong style="color: var(--accent-purple);">${directoryCount}</strong></span>
                    <span>单文件执行: <strong style="color: var(--accent-green);">${fileCount}</strong></span>
                    <span>总处理文件数: <strong style="color: var(--accent-blue);">${totalFilesProcessed}</strong></span>
                    <span>总执行步骤数: <strong style="color: var(--accent-blue);">${totalStepsExecuted}</strong></span>
                    <span>首次使用: ${item.firstUsed ? formatDate(item.firstUsed) : '未知'}</span>
                    <span>最后使用: ${item.lastUsed ? formatDate(item.lastUsed) : '未知'}</span>
                    <button onclick="window.showKeywordStats('event', '${item.eventName}');" style="background: var(--accent-green); color: white; border: none; border-radius: var(--border-radius); padding: 6px 12px; cursor: pointer; font-size: 12px; margin-left: auto;" onmouseenter="this.style.opacity='0.8';" onmouseleave="this.style.opacity='1';">
                        🔑 查看关键字统计
                    </button>
                </div>
            </div>
            <div class="detail-records">
                <h4 style="font-size: 16px; font-weight: 600; margin-bottom: 12px; color: var(--text-primary);">使用记录</h4>
                <div style="max-height: 400px; overflow-y: auto;">
                    ${renderEventRecords(item.records || [])}
                </div>
            </div>
        </div>
    `;
}

function renderEventRecords(records) {
    if (records.length === 0) {
        return '<div style="padding: 20px; text-align: center; color: var(--text-muted);">暂无记录</div>';
    }
    
    return records.map((record, index) => {
        const isDirectory = record.isDirectory || false;
        const directoryPath = record.directoryPath || '';
        const totalFiles = record.totalFiles || 0;
        const totalSteps = record.totalSteps || 0;
        
        return `
        <div style="padding: 12px; margin-bottom: 8px; background: var(--bg-tertiary); border-radius: var(--border-radius); border: 1px solid var(--border);">
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">
                ${formatDateTime(record.timestamp)}
                ${isDirectory ? `<span style="color: var(--accent-purple); margin-left: 8px;">📁 目录执行</span>` : '<span style="color: var(--accent-green); margin-left: 8px;">📄 单文件执行</span>'}
            </div>
            ${isDirectory ? `
                <div style="font-size: 13px; color: var(--text-primary); margin-bottom: 4px;">
                    <strong>目录路径:</strong> ${directoryPath}
                </div>
                <div style="font-size: 13px; color: var(--text-primary); margin-bottom: 4px;">
                    <strong>处理文件数:</strong> ${totalFiles} | <strong>执行步骤数:</strong> ${totalSteps}
                </div>
            ` : ''}
            ${record.content ? `<div style="font-size: 14px; color: var(--text-primary); margin-top: 4px;">
                ${record.content.substring(0, 200) + (record.content.length > 200 ? '...' : '')}
            </div>` : ''}
            ${record.stepFilePath ? `<div style="font-size: 12px; color: var(--accent-blue); margin-top: 4px;">文件: ${record.stepFilePath}</div>` : ''}
        </div>
    `;
    }).join('');
}

function renderViewDetail(item) {
    return `
        <div class="usage-detail-container">
            <div class="detail-header" style="margin-bottom: 24px;">
                <h3 style="font-size: 20px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px;">
                    👁️ 视图: ${item.viewId}
                </h3>
                <div style="display: flex; gap: 16px; font-size: 14px; color: var(--text-muted); align-items: center; flex-wrap: wrap;">
                    <span>使用次数: <strong style="color: var(--accent-blue);">${item.count}</strong></span>
                    <span>首次使用: ${item.firstUsed ? formatDate(item.firstUsed) : '未知'}</span>
                    <span>最后使用: ${item.lastUsed ? formatDate(item.lastUsed) : '未知'}</span>
                    ${item.source ? `<span>数据来源: ${item.source === 'log' ? '日志' : item.source === 'filesystem' ? '文件系统' : '合并'}</span>` : ''}
                    <button onclick="window.showKeywordStats('view', '${item.viewId}');" style="background: var(--accent-green); color: white; border: none; border-radius: var(--border-radius); padding: 6px 12px; cursor: pointer; font-size: 12px; margin-left: auto;" onmouseenter="this.style.opacity='0.8';" onmouseleave="this.style.opacity='1';">
                        🔑 查看关键字统计
                    </button>
                </div>
            </div>
            <div class="detail-records">
                <h4 style="font-size: 16px; font-weight: 600; margin-bottom: 12px; color: var(--text-primary);">使用记录</h4>
                <div style="max-height: 400px; overflow-y: auto;">
                    ${renderRecords(item.records || [])}
                </div>
            </div>
        </div>
    `;
}

function renderRecords(records) {
    if (records.length === 0) {
        return '<div style="padding: 20px; text-align: center; color: var(--text-muted);">暂无记录</div>';
    }
    
    return records.map((record, index) => `
        <div style="padding: 12px; margin-bottom: 8px; background: var(--bg-tertiary); border-radius: var(--border-radius); border: 1px solid var(--border);">
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">
                ${formatDateTime(record.timestamp)}
            </div>
            <div style="font-size: 14px; color: var(--text-primary);">
                ${record.content ? record.content.substring(0, 200) + (record.content.length > 200 ? '...' : '') : '无内容'}
            </div>
            ${record.stepFilePath ? `<div style="font-size: 12px; color: var(--accent-blue); margin-top: 4px;">文件: ${record.stepFilePath}</div>` : ''}
        </div>
    `).join('');
}

function getTypeIcon(type) {
    const icons = {
        workflow: '📋',
        event: '⚡',
        view: '👁️'
    };
    return icons[type] || '📄';
}

function formatDate(dateStr) {
    if (!dateStr) return '未知';
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN');
}

function formatDateTime(dateStr) {
    if (!dateStr) return '未知';
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN');
}

/**
 * 显示关键字统计全屏界面
 * @param {string} type - 类型 'workflow' | 'event' | 'view'
 * @param {string} name - 名称（如果为null则显示全部）
 * @param {string} filterType - 筛选类型（可选，用于筛选显示）
 */
export async function showKeywordStatsModal(type, name, filterType = null) {
    // 创建全屏模态框
    let modal = document.getElementById('keyword-stats-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'keyword-stats-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        `;
        document.body.appendChild(modal);
    }
    
    modal.style.display = 'flex';
    
    // 显示加载状态
    modal.innerHTML = `
        <div style="background: var(--bg-primary); border-radius: var(--border-radius); padding: 24px; max-width: 900px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
            <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                <div style="font-size: 24px; margin-bottom: 12px;">⏳</div>
                <div>正在加载关键字统计...</div>
            </div>
        </div>
    `;
    
    try {
        // 获取关键字统计数据
        let keywordStats = [];
        let allStats = [];
        
        if (name) {
            // 如果有选中项，获取该选中项的关键字统计
            keywordStats = await getKeywordStatsByItem(type, name);
            
            // 如果指定了筛选类型，还需要获取其他类型的关键字用于筛选
            if (filterType) {
                const { getAllKeywordStats } = await import('./keywordStats.js');
                allStats = await getAllKeywordStats({});
            }
        } else {
            // 显示全部关键字（需要从所有库中读取）
            const { getAllKeywordStats } = await import('./keywordStats.js');
            keywordStats = await getAllKeywordStats({ type: filterType, name });
            allStats = keywordStats;
        }
        
        // 确保 keywordStats 是数组
        if (!Array.isArray(keywordStats)) {
            console.warn('[关键字统计] keywordStats 不是数组:', keywordStats);
            keywordStats = [];
        }
        
        console.log('[关键字统计] 获取到关键字统计:', keywordStats.length, '个关键字', keywordStats.slice(0, 3));
        
        // 渲染统计结果
        const title = name 
            ? `${getTypeLabel(type)}: ${name} - 关键字统计${filterType ? ` (筛选: ${getTypeLabel(filterType)})` : ''}`
            : filterType 
                ? `${getTypeLabel(filterType)} - 关键字统计`
                : `全部关键字统计`;
        
        modal.innerHTML = `
            <div style="background: var(--bg-primary); border-radius: var(--border-radius); padding: 24px; max-width: 900px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3); position: relative;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 1px solid var(--border); padding-bottom: 16px;">
                    <h2 style="font-size: 24px; font-weight: 600; color: var(--text-primary); margin: 0;">
                        🔑 ${title}
                    </h2>
                    <button id="close-keyword-stats-modal" style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--border-radius); padding: 8px 16px; cursor: pointer; color: var(--text-primary); font-size: 14px;" onmouseenter="this.style.background='var(--accent-red)'; this.style.color='white';" onmouseleave="this.style.background='var(--bg-secondary)'; this.style.color='var(--text-primary)';">
                        关闭 (ESC)
                    </button>
                </div>
                <div style="margin-bottom: 16px;">
                    <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 12px;">
                        <button id="refresh-keyword-stats" style="background: var(--accent-blue); color: white; border: none; border-radius: var(--border-radius); padding: 8px 16px; cursor: pointer; font-size: 14px; white-space: nowrap;" onmouseenter="this.style.opacity='0.8';" onmouseleave="this.style.opacity='1';">
                            🔄 刷新统计
                        </button>
                        <button id="scan-new-feedback" style="background: var(--accent-green); color: white; border: none; border-radius: var(--border-radius); padding: 8px 16px; cursor: pointer; font-size: 14px; white-space: nowrap;" onmouseenter="this.style.opacity='0.8';" onmouseleave="this.style.opacity='1';">
                            🔍 扫描新反馈文件
                        </button>
                        <div style="display: flex; align-items: center; gap: 8px; padding: 4px 12px; background: var(--bg-secondary); border-radius: var(--border-radius); border: 1px solid var(--border);">
                            <label style="font-size: 13px; color: var(--text-muted); white-space: nowrap;">每批文件数:</label>
                            <input type="number" id="files-per-lib-input" min="1" max="1000" value="100" style="width: 80px; padding: 4px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); font-size: 13px;" />
                        </div>
                        <button id="copy-all-keywords" style="display: none; background: var(--accent-purple); color: white; border: none; border-radius: var(--border-radius); padding: 8px 16px; cursor: pointer; font-size: 14px; white-space: nowrap;" onmouseenter="this.style.opacity='0.8';" onmouseleave="this.style.opacity='1';">
                            📋 复制所有关键字
                        </button>
                        <div id="keyword-stats-count" style="flex: 1; text-align: right; color: var(--text-muted); font-size: 14px; white-space: nowrap;">
                            共找到 ${keywordStats.length} 个关键字
                        </div>
                    </div>
                    ${name ? `
                    <div style="display: flex; gap: 8px; align-items: center; padding: 12px; background: var(--bg-secondary); border-radius: var(--border-radius); border: 1px solid var(--border);">
                        <span style="font-size: 13px; color: var(--text-muted);">筛选显示:</span>
                        <button id="filter-all" class="filter-btn" data-filter="all" style="background: ${filterType === null || filterType === undefined ? 'var(--accent-blue)' : 'var(--bg-tertiary)'}; color: ${filterType === null || filterType === undefined ? 'white' : 'var(--text-primary)'}; border: 1px solid var(--border); border-radius: var(--border-radius); padding: 6px 12px; cursor: pointer; font-size: 12px;">全部</button>
                        <button id="filter-workflow" class="filter-btn" data-filter="workflow" style="background: ${filterType === 'workflow' ? 'var(--accent-blue)' : 'var(--bg-tertiary)'}; color: ${filterType === 'workflow' ? 'white' : 'var(--text-primary)'}; border: 1px solid var(--border); border-radius: var(--border-radius); padding: 6px 12px; cursor: pointer; font-size: 12px;">工作流</button>
                        <button id="filter-event" class="filter-btn" data-filter="event" style="background: ${filterType === 'event' ? 'var(--accent-blue)' : 'var(--bg-tertiary)'}; color: ${filterType === 'event' ? 'white' : 'var(--text-primary)'}; border: 1px solid var(--border); border-radius: var(--border-radius); padding: 6px 12px; cursor: pointer; font-size: 12px;">事件</button>
                        <button id="filter-view" class="filter-btn" data-filter="view" style="background: ${filterType === 'view' ? 'var(--accent-blue)' : 'var(--bg-tertiary)'}; color: ${filterType === 'view' ? 'white' : 'var(--text-primary)'}; border: 1px solid var(--border); border-radius: var(--border-radius); padding: 6px 12px; cursor: pointer; font-size: 12px;">视图</button>
                    </div>
                    ` : ''}
                </div>
                <div id="keyword-stats-content" style="min-height: 200px;">
                    ${renderKeywordStatsList(keywordStats)}
                </div>
            </div>
        `;
        
        // 加载并绑定批次大小配置
        const filesPerLibInput = document.getElementById('files-per-lib-input');
        if (filesPerLibInput) {
            // 加载保存的配置
            const { getFilesPerLib, saveFilesPerLib } = await import('./keywordStats.js');
            const currentValue = getFilesPerLib();
            filesPerLibInput.value = currentValue;
            
            // 绑定保存事件
            filesPerLibInput.addEventListener('change', (e) => {
                const value = parseInt(e.target.value) || 100;
                if (value < 1) {
                    e.target.value = 1;
                    saveFilesPerLib(1);
                } else if (value > 1000) {
                    e.target.value = 1000;
                    saveFilesPerLib(1000);
                } else {
                    saveFilesPerLib(value);
                    console.log(`[关键字统计] 批次大小配置已更新: ${value}`);
                }
            });
        }
        
        // 渲染完成后，确保计数正确（从实际渲染的内容中统计，防止数据不一致）
        setTimeout(() => {
            const contentEl = document.getElementById('keyword-stats-content');
            const countEl = document.getElementById('keyword-stats-count');
            if (contentEl && countEl) {
                // 从实际渲染的内容中统计关键字数量
                const renderedKeywords = contentEl.querySelectorAll('[id^="keyword-"]');
                const actualCount = renderedKeywords.length;
                if (actualCount !== keywordStats.length) {
                    console.log(`[关键字统计] 计数不一致，修正: ${keywordStats.length} -> ${actualCount}`);
                    countEl.textContent = `共找到 ${actualCount} 个关键字`;
                }
            }
        }, 100);
        
        // 绑定关闭事件
        const closeBtn = document.getElementById('close-keyword-stats-modal');
        if (closeBtn) {
            closeBtn.onclick = () => {
                modal.style.display = 'none';
            };
        }
        
        // ESC键关闭
        const handleEsc = (e) => {
            if (e.key === 'Escape' && modal.style.display === 'flex') {
                modal.style.display = 'none';
                document.removeEventListener('keydown', handleEsc);
            }
        };
        document.addEventListener('keydown', handleEsc);
        
        // 刷新按钮（重新扫描文件并检索）
        const refreshBtn = document.getElementById('refresh-keyword-stats');
        if (refreshBtn) {
            refreshBtn.onclick = async () => {
                refreshBtn.disabled = true;
                refreshBtn.textContent = '⏳ 刷新中...';
                try {
                    // 先检查规则配置是否变化（用于更新规则版本，但不影响是否重新处理）
                    const { scanAndProcessNewFeedbackFiles, checkRulesVersionChanged } = await import('./keywordStats.js');
                    await checkRulesVersionChanged(); // 更新规则版本，但不影响处理逻辑
                    
                    // 强制重新扫描并处理所有反馈文件（无论规则是否变化都重新处理）
                    const processedCount = await scanAndProcessNewFeedbackFiles(true); // 强制重新处理
                    console.log(`[关键字统计] 刷新完成，处理了 ${processedCount} 个反馈文件`);
                    
                    // 然后获取最新的统计数据
                    let stats = [];
                    if (name) {
                        stats = await getKeywordStatsByItem(type, name);
                    } else {
                        const { getAllKeywordStats } = await import('./keywordStats.js');
                        stats = await getAllKeywordStats({ type, name });
                    }
                    
                    // 确保 stats 是数组
                    if (!Array.isArray(stats)) {
                        console.warn('[关键字统计] stats 不是数组:', stats);
                        stats = [];
                    }
                    
                    // 更新内容
                    const contentEl = document.getElementById('keyword-stats-content');
                    if (contentEl) {
                        contentEl.innerHTML = renderKeywordStatsList(stats);
                    }
                    
                    // 更新计数显示
                    const countEl = document.getElementById('keyword-stats-count');
                    if (countEl) {
                        countEl.textContent = `共找到 ${stats.length} 个关键字`;
                    }
                    
                    // 更新关键字统计变量（用于复制功能）
                    keywordStats = stats;
                } catch (err) {
                    console.error('[关键字统计] 刷新失败:', err);
                    alert('刷新失败: ' + err.message);
                } finally {
                    refreshBtn.disabled = false;
                    refreshBtn.textContent = '🔄 刷新统计';
                }
            };
        }
        
        // 扫描新反馈文件按钮
        const scanBtn = document.getElementById('scan-new-feedback');
        if (scanBtn) {
            scanBtn.onclick = async () => {
                scanBtn.disabled = true;
                scanBtn.textContent = '⏳ 扫描中...';
                try {
                    const processedCount = await scanAndProcessNewFeedbackFiles();
                    alert(`扫描完成！处理了 ${processedCount} 个新反馈文件。`);
                    // 刷新统计
                    if (refreshBtn) {
                        refreshBtn.click();
                    }
                } catch (err) {
                    alert('扫描失败: ' + err.message);
                } finally {
                    scanBtn.disabled = false;
                    scanBtn.textContent = '🔍 扫描新反馈文件';
                }
            };
        }
        
        // 复制所有关键字按钮
        const copyAllBtn = document.getElementById('copy-all-keywords');
        if (copyAllBtn) {
            copyAllBtn.onclick = () => {
                try {
                    // 格式化所有关键字
                    const keywordsText = keywordStats.map((stat, index) => 
                        `${index + 1}. <<${stat.keyword}>> (出现 ${stat.count} 次)`
                    ).join('\n');
                    
                    const fullText = `关键字统计 - ${title}\n\n共 ${keywordStats.length} 个关键字：\n\n${keywordsText}`;
                    
                    // 复制到剪贴板
                    navigator.clipboard.writeText(fullText).then(() => {
                        // 临时改变按钮文本提示复制成功
                        const originalText = copyAllBtn.textContent;
                        copyAllBtn.textContent = '✅ 已复制';
                        copyAllBtn.style.background = 'var(--accent-green)';
                        setTimeout(() => {
                            copyAllBtn.textContent = originalText;
                            copyAllBtn.style.background = 'var(--accent-purple)';
                        }, 2000);
                    }).catch(err => {
                        // 降级方案：使用传统方法
                        const textArea = document.createElement('textarea');
                        textArea.value = fullText;
                        textArea.style.position = 'fixed';
                        textArea.style.opacity = '0';
                        document.body.appendChild(textArea);
                        textArea.select();
                        try {
                            document.execCommand('copy');
                            const originalText = copyAllBtn.textContent;
                            copyAllBtn.textContent = '✅ 已复制';
                            copyAllBtn.style.background = 'var(--accent-green)';
                            setTimeout(() => {
                                copyAllBtn.textContent = originalText;
                                copyAllBtn.style.background = 'var(--accent-purple)';
                            }, 2000);
                        } catch (e) {
                            alert('复制失败，请手动选择文本复制');
                        }
                        document.body.removeChild(textArea);
                    });
                } catch (err) {
                    alert('复制失败: ' + err.message);
                }
            };
        }
        
        // 筛选按钮（仅在选中项时显示，用于筛选显示不同类型的关键字）
        let currentFilterType = filterType;
        if (name) {
            const filterButtons = document.querySelectorAll('.filter-btn');
            filterButtons.forEach(btn => {
                btn.onclick = async () => {
                    const newFilterType = btn.dataset.filter === 'all' ? null : btn.dataset.filter;
                    currentFilterType = newFilterType;
                    
                    // 更新按钮样式
                    filterButtons.forEach(b => {
                        const isActive = (newFilterType === null && b.dataset.filter === 'all') || 
                                        (newFilterType && b.dataset.filter === newFilterType);
                        b.style.background = isActive ? 'var(--accent-blue)' : 'var(--bg-tertiary)';
                        b.style.color = isActive ? 'white' : 'var(--text-primary)';
                    });
                    
                    // 重新加载统计数据
                    let stats = [];
                    if (newFilterType) {
                        // 根据筛选类型获取对应的关键字统计
                        // 如果筛选类型与选中项类型相同，显示选中项的关键字
                        if (newFilterType === type) {
                            stats = await getKeywordStatsByItem(type, name);
                        } else {
                            // 获取筛选类型的所有关键字（显示该类型的所有关键字）
                            const { getAllKeywordStats } = await import('./keywordStats.js');
                            stats = await getAllKeywordStats({ type: newFilterType });
                        }
                    } else {
                        // 显示选中项的所有关键字（不筛选）
                        stats = await getKeywordStatsByItem(type, name);
                    }
                    
                    keywordStats = stats; // 更新当前关键字统计
                    
                    const contentEl = document.getElementById('keyword-stats-content');
                    if (contentEl) {
                        contentEl.innerHTML = renderKeywordStatsList(stats);
                    }
                    
                    // 更新关键字数量
                    const countEl = document.getElementById('keyword-stats-count');
                    if (countEl) {
                        countEl.textContent = `共找到 ${stats.length} 个关键字`;
                    }
                    
                    // 更新标题
                    const titleEl = document.querySelector('h2');
                    if (titleEl) {
                        titleEl.textContent = `🔑 ${getTypeLabel(type)}: ${name} - 关键字统计${newFilterType ? ` (筛选: ${getTypeLabel(newFilterType)})` : ''}`;
                    }
                };
            });
        }
        
    } catch (err) {
        console.error('[关键字统计] 显示统计失败:', err);
        modal.innerHTML = `
            <div style="background: var(--bg-primary); border-radius: var(--border-radius); padding: 24px; max-width: 900px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                <div style="text-align: center; padding: 40px; color: var(--accent-red);">
                    <div style="font-size: 24px; margin-bottom: 12px;">❌</div>
                    <div>加载失败: ${err.message}</div>
                    <button onclick="document.getElementById('keyword-stats-modal').style.display='none';" style="margin-top: 16px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--border-radius); padding: 8px 16px; cursor: pointer;">
                        关闭
                    </button>
                </div>
            </div>
        `;
    }
}

/**
 * 渲染关键字统计列表
 * @param {Array} keywordStats - 关键字统计数组
 */
function renderKeywordStatsList(keywordStats) {
    if (keywordStats.length === 0) {
        return `
            <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                <div style="font-size: 24px; margin-bottom: 12px;">📭</div>
                <div>暂无关键字统计</div>
                <div style="font-size: 12px; margin-top: 8px; color: var(--text-muted);">
                    提示：在反馈文件中使用 &lt;&lt;关键字&gt;&gt; 格式标记关键字
                </div>
            </div>
        `;
    }
    
    // 计算最大出现次数（用于比例显示）
    const maxCount = Math.max(...keywordStats.map(s => s.count));
    
    return `
        <div style="display: grid; gap: 12px;">
            ${keywordStats.map((stat, index) => {
                const percentage = (stat.count / maxCount) * 100;
                const keywordId = `keyword-${index}`;
                return `
                    <div id="${keywordId}" style="padding: 16px; background: var(--bg-tertiary); border-radius: var(--border-radius); border: 1px solid var(--border); position: relative;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <div style="font-size: 16px; font-weight: 600; color: var(--text-primary); flex: 1;">
                                ${index + 1}. ${stat.fullMatch ? stat.fullMatch.replace(/</g, '&lt;').replace(/>/g, '&gt;') : `&lt;&lt;${stat.keyword}&gt;&gt;`}
                            </div>
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <div style="font-size: 18px; font-weight: 600; color: var(--accent-blue);">
                                    ${stat.count} 次
                                </div>
                                <button onclick="copySingleKeyword('${stat.keyword.replace(/'/g, "\\'")}', ${stat.count}, '${keywordId}')" style="background: var(--accent-purple); color: white; border: none; border-radius: var(--border-radius); padding: 4px 12px; cursor: pointer; font-size: 12px; white-space: nowrap;" onmouseenter="this.style.opacity='0.8';" onmouseleave="this.style.opacity='1';" title="复制此关键字">
                                    📋 复制
                                </button>
                            </div>
                        </div>
                        <div style="height: 8px; background: var(--bg-secondary); border-radius: 4px; overflow: hidden;">
                            <div style="height: 100%; background: linear-gradient(90deg, var(--accent-blue), var(--accent-green)); width: ${percentage}%; transition: width 0.3s;"></div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

/**
 * 复制单个关键字
 * @param {string} keyword - 关键字
 * @param {number} count - 出现次数
 * @param {string} elementId - 元素ID（用于显示复制成功提示）
 */
function copySingleKeyword(keyword, count, elementId) {
    try {
        const keywordText = `<<${keyword}>> (出现 ${count} 次)`;
        
        // 复制到剪贴板
        navigator.clipboard.writeText(keywordText).then(() => {
            // 显示复制成功提示
            const element = document.getElementById(elementId);
            if (element) {
                const button = element.querySelector('button');
                if (button) {
                    const originalText = button.textContent;
                    button.textContent = '✅ 已复制';
                    button.style.background = 'var(--accent-green)';
                    setTimeout(() => {
                        button.textContent = originalText;
                        button.style.background = 'var(--accent-purple)';
                    }, 2000);
                }
            }
        }).catch(err => {
            // 降级方案：使用传统方法
            const textArea = document.createElement('textarea');
            textArea.value = keywordText;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                const element = document.getElementById(elementId);
                if (element) {
                    const button = element.querySelector('button');
                    if (button) {
                        const originalText = button.textContent;
                        button.textContent = '✅ 已复制';
                        button.style.background = 'var(--accent-green)';
                        setTimeout(() => {
                            button.textContent = originalText;
                            button.style.background = 'var(--accent-purple)';
                        }, 2000);
                    }
                }
            } catch (e) {
                alert('复制失败，请手动选择文本复制');
            }
            document.body.removeChild(textArea);
        });
    } catch (err) {
        alert('复制失败: ' + err.message);
    }
}

// 暴露全局函数供内联事件使用
if (typeof window !== 'undefined') {
    window.copySingleKeyword = copySingleKeyword;
}

/**
 * 获取类型标签
 */
function getTypeLabel(type) {
    const labels = {
        workflow: '工作流',
        event: '事件',
        view: '视图'
    };
    return labels[type] || type;
}

// 暴露全局函数
if (typeof window !== 'undefined') {
    window.showKeywordStats = showKeywordStatsModal;
}

