/**
 * 关键字识别管理模块
 * 负责管理多个关键字识别规则，支持自定义开头和结尾标识符
 */

import { getFile, saveFile, getDirectory, createFolder } from '../../core/api.js';

const RECOGNITION_DIR = 'fankui_log/shibieguanli';
const RULES_FILE = 'recognition_rules.md';
const FUNCTIONS_DIR = 'js/modules/usage/keywordRecognitionFunctions';

// 文件缓存：避免频繁读取文件
const fileCache = {
    rulesFile: {
        content: null,
        lastModified: null
    }
};

/**
 * 确保识别管理目录存在
 */
async function ensureRecognitionDir() {
    try {
        await getDirectory(RECOGNITION_DIR);
    } catch (err) {
        // 目录不存在，创建它
        try {
            await createFolder(RECOGNITION_DIR);
        } catch (createErr) {
            console.warn('[关键字识别管理] 创建识别管理目录失败:', createErr);
            throw createErr;
        }
    }
}

/**
 * 获取规则文件路径
 */
function getRulesFilePath() {
    return `${RECOGNITION_DIR}/${RULES_FILE}`;
}

/**
 * 读取规则文件（带缓存机制）
 * @returns {Promise<string>} 文件内容
 */
async function readRulesFile() {
    try {
        const filePath = getRulesFilePath();
        
        // 检查文件是否存在
        let fileStats;
        try {
            // 尝试获取文件信息（通过读取目录）
            const dirData = await getDirectory(RECOGNITION_DIR);
            const file = dirData.files.find(f => f.name === RULES_FILE);
            if (!file) {
                // 文件不存在，返回空内容
                fileCache.rulesFile.content = '';
                fileCache.rulesFile.lastModified = null;
                return '';
            }
            // 使用文件路径获取文件内容（每次都重新读取，不使用文件大小检测）
            const content = await getFile(filePath);
            
            // 检查返回内容是否是错误信息（getFile API在文件不存在时返回JSON错误信息）
            if (content && typeof content === 'string' && content.trim().startsWith('{') && content.includes('"error"')) {
                // 文件不存在，清理缓存并返回空内容
                fileCache.rulesFile.content = '';
                fileCache.rulesFile.lastModified = null;
                return '';
            }
            
            // 每次都更新缓存
            fileCache.rulesFile.content = content;
            fileCache.rulesFile.lastModified = Date.now();
            return content;
        } catch (err) {
            // 文件不存在或无法读取
            if (err.message && err.message.includes('not found')) {
                fileCache.rulesFile.content = '';
                fileCache.rulesFile.lastModified = null;
                return '';
            }
            throw err;
        }
    } catch (err) {
        console.error('[关键字识别管理] 读取规则文件失败:', err);
        // 如果文件不存在，返回空字符串
        if (err.message && err.message.includes('not found')) {
            return '';
        }
        throw err;
    }
}

/**
 * 保存规则文件
 * @param {string} content - 文件内容
 */
async function saveRulesFile(content) {
    try {
        await ensureRecognitionDir();
        const filePath = getRulesFilePath();
        await saveFile(filePath, content);
        
        // 更新缓存
        fileCache.rulesFile.content = content;
        fileCache.rulesFile.lastModified = Date.now();
    } catch (err) {
        console.error('[关键字识别管理] 保存规则文件失败:', err);
        throw err;
    }
}

/**
 * 解析规则文件内容为规则数组
 * @param {string} content - 文件内容
 * @returns {Array} 规则数组
 */
function parseRulesFromContent(content) {
    if (!content || !content.trim()) {
        return [];
    }
    
    const rules = [];
    const lines = content.split('\n');
    let currentRule = null;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // 检测规则开始：## 规则标题
        if (line.startsWith('## ')) {
            // 保存上一个规则
            if (currentRule) {
                rules.push(currentRule);
            }
            
            // 开始新规则
            const title = line.substring(3).trim();
            currentRule = {
                id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                title: title,
                startSymbol: '',
                endSymbol: '',
                enabled: true,
                functionDescription: '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
        } else if (currentRule) {
            // 解析规则属性 - 使用更准确的方法：找到冒号位置，取冒号后的内容
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const value = line.substring(colonIndex + 1).trim();
                
                if (line.startsWith('- **标题**:')) {
                    currentRule.title = value;
                } else if (line.startsWith('- **开头标识**:')) {
                    currentRule.startSymbol = value;
                } else if (line.startsWith('- **结尾标识**:')) {
                    currentRule.endSymbol = value;
                } else if (line.startsWith('- **是否开启**:')) {
                    // 更严格的enabled判断
                    currentRule.enabled = value === '是' || value.toLowerCase() === 'true' || value === '✓' || value === '1' || value === 'yes';
                } else if (line.startsWith('- **功能描述**:')) {
                    currentRule.functionDescription = value;
                } else if (line.startsWith('- **创建时间**:')) {
                    if (value) {
                        currentRule.createdAt = value;
                    }
                } else if (line.startsWith('- **更新时间**:')) {
                    if (value) {
                        currentRule.updatedAt = value;
                    }
                } else if (line.startsWith('- **ID**:')) {
                    if (value) {
                        currentRule.id = value;
                    }
                }
            }
        }
    }
    
    // 保存最后一个规则
    if (currentRule) {
        rules.push(currentRule);
    }
    
    return rules;
}

/**
 * 将规则数组转换为Markdown内容
 * @param {Array} rules - 规则数组
 * @returns {string} Markdown内容
 */
function convertRulesToContent(rules) {
    if (!rules || rules.length === 0) {
        return '# 关键字识别规则管理\n\n暂无规则。\n';
    }
    
    let content = '# 关键字识别规则管理\n\n';
    
    rules.forEach((rule, index) => {
        content += `## ${rule.title || `规则 ${index + 1}`}\n\n`;
        content += `- **ID**: ${rule.id || ''}\n`;
        content += `- **标题**: ${rule.title || ''}\n`;
        content += `- **开头标识**: ${rule.startSymbol || ''}\n`;
        content += `- **结尾标识**: ${rule.endSymbol || ''}\n`;
        content += `- **是否开启**: ${rule.enabled ? '是' : '否'}\n`;
        content += `- **功能描述**: ${rule.functionDescription || ''}\n`;
        content += `- **创建时间**: ${rule.createdAt || new Date().toISOString()}\n`;
        content += `- **更新时间**: ${rule.updatedAt || new Date().toISOString()}\n`;
        content += '\n';
    });
    
    return content;
}

/**
 * 获取所有识别规则
 * @returns {Promise<Array>} 规则数组
 */
export async function getAllRecognitionRules() {
    try {
        await ensureRecognitionDir();
        const content = await readRulesFile();
        return parseRulesFromContent(content);
    } catch (err) {
        console.error('[关键字识别管理] 获取识别规则失败:', err);
        return [];
    }
}

/**
 * 保存所有识别规则
 * @param {Array} rules - 规则数组
 */
export async function saveAllRecognitionRules(rules) {
    try {
        const content = convertRulesToContent(rules);
        await saveRulesFile(content);
    } catch (err) {
        console.error('[关键字识别管理] 保存识别规则失败:', err);
        throw err;
    }
}

/**
 * 添加新规则
 * @param {object} rule - 规则对象 {title, startSymbol, endSymbol, enabled}
 * @returns {Promise<object>} 添加的规则（包含ID和时间戳）
 */
export async function addRecognitionRule(rule) {
    try {
        const rules = await getAllRecognitionRules();
        
            const newRule = {
                id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                title: rule.title || '未命名规则',
                startSymbol: rule.startSymbol || '',
                endSymbol: rule.endSymbol || '',
                enabled: (() => {
                if (rule.enabled === undefined) return true;
                if (typeof rule.enabled === 'boolean') return rule.enabled;
                if (typeof rule.enabled === 'string') {
                    return rule.enabled === 'true' || rule.enabled === '是' || rule.enabled === '1' || rule.enabled === 'yes' || rule.enabled === '✓';
                }
                return Boolean(rule.enabled);
            })(),
                functionDescription: rule.functionDescription || '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
        
        rules.push(newRule);
        await saveAllRecognitionRules(rules);
        
        // 清除关键字统计模块的规则缓存
        try {
            const { clearRecognitionRulesCache } = await import('./keywordStats.js');
            clearRecognitionRulesCache();
        } catch (err) {
            // 忽略错误
        }
        
        return newRule;
    } catch (err) {
        console.error('[关键字识别管理] 添加识别规则失败:', err);
        throw err;
    }
}

/**
 * 更新规则
 * @param {string} ruleId - 规则ID
 * @param {object} updates - 要更新的字段 {title?, startSymbol?, endSymbol?, enabled?}
 * @returns {Promise<object>} 更新后的规则
 */
export async function updateRecognitionRule(ruleId, updates) {
    try {
        const rules = await getAllRecognitionRules();
        const ruleIndex = rules.findIndex(r => r.id === ruleId);
        
        if (ruleIndex === -1) {
            throw new Error(`规则不存在: ${ruleId}`);
        }
        
        // 更新规则
        if (updates.title !== undefined) rules[ruleIndex].title = updates.title;
        if (updates.startSymbol !== undefined) rules[ruleIndex].startSymbol = updates.startSymbol;
        if (updates.endSymbol !== undefined) rules[ruleIndex].endSymbol = updates.endSymbol;
        if (updates.enabled !== undefined) {
            // 确保enabled是布尔值
            if (typeof updates.enabled === 'boolean') {
                rules[ruleIndex].enabled = updates.enabled;
            } else if (typeof updates.enabled === 'string') {
                rules[ruleIndex].enabled = updates.enabled === 'true' || updates.enabled === '是' || updates.enabled === '1' || updates.enabled === 'yes' || updates.enabled === '✓';
            } else {
                rules[ruleIndex].enabled = Boolean(updates.enabled);
            }
        }
        if (updates.functionDescription !== undefined) rules[ruleIndex].functionDescription = updates.functionDescription;
        rules[ruleIndex].updatedAt = new Date().toISOString();
        
        await saveAllRecognitionRules(rules);
        
        // 清除关键字统计模块的规则缓存
        try {
            const { clearRecognitionRulesCache } = await import('./keywordStats.js');
            clearRecognitionRulesCache();
        } catch (err) {
            // 忽略错误
        }
        
        return rules[ruleIndex];
    } catch (err) {
        console.error('[关键字识别管理] 更新识别规则失败:', err);
        throw err;
    }
}

/**
 * 删除规则（软删除，移动到回收站）
 * @param {string} ruleId - 规则ID
 */
export async function deleteRecognitionRule(ruleId) {
    try {
        // 使用软删除逻辑（与回收站、目录删除按钮相同的逻辑）
        const filePath = getRulesFilePath();
        
        // 先读取当前规则
        const rules = await getAllRecognitionRules();
        const ruleIndex = rules.findIndex(r => r.id === ruleId);
        
        if (ruleIndex === -1) {
            throw new Error(`规则不存在: ${ruleId}`);
        }
        
        // 从数组中移除
        rules.splice(ruleIndex, 1);
        
        // 保存更新后的规则
        await saveAllRecognitionRules(rules);
        
        // 清除关键字统计模块的规则缓存
        try {
            const { clearRecognitionRulesCache } = await import('./keywordStats.js');
            clearRecognitionRulesCache();
        } catch (err) {
            // 忽略错误
        }
        
        // 清理该规则相关的函数文件
        await cleanupRuleFunctionFiles(ruleId);
        
        return true;
    } catch (err) {
        console.error('[关键字识别管理] 删除识别规则失败:', err);
        throw err;
    }
}

/**
 * 清理文件缓存（当文件被删除时调用）
 */
export function clearFileCache() {
    fileCache.rulesFile.content = null;
    fileCache.rulesFile.lastModified = null;
}

/**
 * 显示关键字识别管理面板
 */
export async function showKeywordRecognitionManager() {
    const panel = document.getElementById('keyword-recognition-panel');
    if (!panel) {
        console.error('[关键字识别管理] 面板不存在');
        return;
    }
    
    // 显示面板
    panel.style.display = 'flex';
    panel.focus();
    
    // 加载规则列表
    let rules = [];
    try {
        rules = await getAllRecognitionRules();
    } catch (err) {
        console.error('[关键字识别管理] 加载规则失败:', err);
    }
    
    // 如果没有规则，添加默认规则（<< >>）
    if (rules.length === 0) {
        try {
            const defaultRule = await addRecognitionRule({
                title: '默认关键字识别',
                startSymbol: '<<',
                endSymbol: '>>',
                enabled: true,
                functionDescription: '用于标记和统计重要概念、关键信息等，系统会自动识别这些关键字并在关键字统计面板中显示出现次数'
            });
            rules = [defaultRule];
        } catch (err) {
            console.error('[关键字识别管理] 创建默认规则失败:', err);
        }
    }
    
    // 渲染面板
    renderRulesList(rules);
    updateEnabledRulesCount(rules);
    await resetRuleForm();
}

/**
 * 获取最大限制配置（固定为1TB）
 * @returns {number} 最大限制值（1TB = 1,000,000,000,000）
 */
export function getKeywordRecognitionMaxLimit() {
    return 1000000000000; // 1TB
}

// 当前编辑的规则
let currentEditingRule = null;

/**
 * 渲染规则列表（左侧边栏）
 * @param {Array} rules - 规则数组
 * @param {string} searchTerm - 搜索关键词
 */
export async function renderRulesList(rules, searchTerm = '') {
    // 如果没有传入rules，则获取所有规则
    if (!rules) {
        rules = await getAllRecognitionRules();
    }
    const list = document.getElementById('keyword-recognition-rules-list');
    if (!list) return;
    
    list.innerHTML = '';
    
    // 过滤规则
    const filteredRules = rules.filter(rule =>
        !searchTerm || rule.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (rule.functionDescription && rule.functionDescription.toLowerCase().includes(searchTerm.toLowerCase()))
    );
    
    if (filteredRules.length === 0) {
        list.innerHTML = '<div style="color: var(--text-muted); font-style: italic; padding: 10px; text-align: center;">没有找到匹配的规则</div>';
        return;
    }
    
    // 渲染规则列表项
    filteredRules.forEach(rule => {
        const item = document.createElement('div');
        item.className = 'prompt-item';
        const isSelected = currentEditingRule && currentEditingRule.id === rule.id;
        const enabled = rule.enabled === true || rule.enabled === 'true' || rule.enabled === '是' || rule.enabled === '1' || rule.enabled === 'yes';
        
        item.innerHTML = `
            <div class="file-item type-file ${isSelected ? 'selected' : ''}" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; margin-bottom: 6px; cursor: pointer; position: relative;" data-rule-id="${rule.id}">
                <div style="flex: 1; min-width: 0; text-align: left;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                        <div style="font-weight: bold; color: var(--accent-blue); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(rule.title || '未命名规则')}</div>
                        <span style="padding: 2px 6px; border-radius: 4px; font-size: 11px; background: ${enabled ? 'var(--success, #4ade80)' : 'var(--text-muted)'}; color: white;">
                            ${enabled ? '✓' : '✗'}
                        </span>
                    </div>
                    <div style="font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-left: 2px;">
                        <code style="background: var(--bg-tertiary); padding: 1px 4px; border-radius: 3px; font-size: 10px;">${escapeHtml(rule.startSymbol || '')}</code>
                        <span style="margin: 0 4px;">...</span>
                        <code style="background: var(--bg-tertiary); padding: 1px 4px; border-radius: 3px; font-size: 10px;">${escapeHtml(rule.endSymbol || '')}</code>
                    </div>
                </div>
                <div style="display: flex; gap: 5px; position: absolute; right: 14px; transition: opacity 0.3s; opacity: 0;" class="rule-actions">
                    <button class="btn" onclick="event.stopPropagation(); window.editKeywordRecognitionRule('${rule.id}')" style="font-size: 12px; padding: 4px 8px;">编辑</button>
                    <button class="btn" onclick="event.stopPropagation(); window.deleteKeywordRecognitionRule('${rule.id}')" style="font-size: 12px; padding: 4px 8px;">删除</button>
                </div>
            </div>
        `;
        
        list.appendChild(item);
        
        const ruleItem = item.querySelector('.file-item');
        const actions = item.querySelector('.rule-actions');
        ruleItem.addEventListener('mouseenter', () => actions.style.opacity = '1');
        ruleItem.addEventListener('mouseleave', () => actions.style.opacity = '0');
        ruleItem.addEventListener('click', () => {
            selectRule(rule);
        });
    });
}

/**
 * 更新启用规则数量显示
 * @param {Array} rules - 规则数组
 */
function updateEnabledRulesCount(rules) {
    const countEl = document.getElementById('current-enabled-rules-count');
    if (countEl) {
        const enabledCount = rules.filter(r => r.enabled === true || r.enabled === 'true' || r.enabled === '是' || r.enabled === '1' || r.enabled === 'yes').length;
        countEl.textContent = `${enabledCount} 个`;
    }
}

/**
 * 选择规则（加载到编辑表单）
 * @param {object} rule - 规则对象
 */
async function selectRule(rule) {
    currentEditingRule = rule;
    await loadRuleToForm(rule);
    const rules = await getAllRecognitionRules();
    renderRulesList(rules);
}

/**
 * 加载规则到表单
 * @param {object} rule - 规则对象
 */
async function loadRuleToForm(rule) {
    if (!rule) {
        await resetRuleForm();
        return;
    }
    
    const titleInput = document.getElementById('keyword-recognition-rule-title');
    const startSymbolInput = document.getElementById('keyword-recognition-rule-start-symbol');
    const endSymbolInput = document.getElementById('keyword-recognition-rule-end-symbol');
    const enabledInput = document.getElementById('keyword-recognition-rule-enabled');
    const descriptionInput = document.getElementById('keyword-recognition-rule-description');
    
    if (titleInput) titleInput.value = rule.title || '';
    if (startSymbolInput) startSymbolInput.value = rule.startSymbol || '';
    if (endSymbolInput) endSymbolInput.value = rule.endSymbol || '';
    if (enabledInput) enabledInput.checked = rule.enabled === true || rule.enabled === 'true' || rule.enabled === '是' || rule.enabled === '1' || rule.enabled === 'yes';
    if (descriptionInput) descriptionInput.value = rule.functionDescription || '';
    
    // 加载已保存的代码到输入框
    await loadSavedCodeToInput();
    
    // 显示保存和取消按钮
    const saveBtn = document.getElementById('save-keyword-recognition-rule');
    const cancelBtn = document.getElementById('cancel-keyword-recognition-edit');
    if (saveBtn) saveBtn.style.display = 'flex';
    if (cancelBtn) cancelBtn.style.display = 'flex';
}

/**
 * 重置规则表单
 */
async function resetRuleForm() {
    currentEditingRule = null;
    
    const titleInput = document.getElementById('keyword-recognition-rule-title');
    const startSymbolInput = document.getElementById('keyword-recognition-rule-start-symbol');
    const endSymbolInput = document.getElementById('keyword-recognition-rule-end-symbol');
    const enabledInput = document.getElementById('keyword-recognition-rule-enabled');
    const descriptionInput = document.getElementById('keyword-recognition-rule-description');
    
    if (titleInput) titleInput.value = '';
    if (startSymbolInput) startSymbolInput.value = '';
    if (endSymbolInput) endSymbolInput.value = '';
    if (enabledInput) enabledInput.checked = true;
    if (descriptionInput) descriptionInput.value = '';
    
    // 隐藏保存和取消按钮
    const saveBtn = document.getElementById('save-keyword-recognition-rule');
    const cancelBtn = document.getElementById('cancel-keyword-recognition-edit');
    if (saveBtn) saveBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
    
    // 重新渲染列表以取消选中状态
    const rules = await getAllRecognitionRules();
    renderRulesList(rules);
}

/**
 * 渲染管理面板（已废弃，保留用于兼容）
 * @param {HTMLElement} modal - 模态框元素
 * @param {Array} rules - 规则数组
 */
function renderManagerPanel(modal, rules) {
    const rulesListHtml = rules.map((rule, index) => `
        <div class="recognition-rule-item" data-rule-id="${rule.id}" style="
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: var(--border-radius);
            padding: 16px;
            margin-bottom: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        ">
            <div style="flex: 1;">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                    <h3 style="margin: 0; font-size: 16px; color: var(--text-primary);">
                        ${rule.title || '未命名规则'}
                    </h3>
                    <span style="
                        padding: 2px 8px;
                        border-radius: 4px;
                        font-size: 12px;
                        background: ${(rule.enabled === true || rule.enabled === 'true' || rule.enabled === '是' || rule.enabled === '1' || rule.enabled === 'yes') ? 'var(--accent-green, #4ade80)' : 'var(--text-muted)'};
                        color: white;
                    ">
                        ${(rule.enabled === true || rule.enabled === 'true' || rule.enabled === '是' || rule.enabled === '1' || rule.enabled === 'yes') ? '✓ 已开启' : '✗ 已关闭'}
                    </span>
                </div>
                <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 4px;">
                    <strong>开头标识:</strong> <code style="background: var(--bg-tertiary); padding: 2px 6px; border-radius: 4px;">${escapeHtml(rule.startSymbol || '')}</code>
                    <strong style="margin-left: 16px;">结尾标识:</strong> <code style="background: var(--bg-tertiary); padding: 2px 6px; border-radius: 4px;">${escapeHtml(rule.endSymbol || '')}</code>
                </div>
                ${rule.functionDescription ? `
                <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
                    <strong>功能描述:</strong> ${escapeHtml(rule.functionDescription)}
                </div>
                ` : ''}
                <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
                    更新时间: ${rule.updatedAt ? (() => {
                        try {
                            return new Date(rule.updatedAt).toLocaleString();
                        } catch (e) {
                            return rule.updatedAt;
                        }
                    })() : '未知'}
                </div>
            </div>
            <div style="display: flex; gap: 8px;">
                <button class="btn-edit-rule" data-rule-id="${rule.id}" style="
                    background: var(--accent-blue);
                    color: white;
                    border: none;
                    border-radius: var(--border-radius);
                    padding: 6px 12px;
                    cursor: pointer;
                    font-size: 13px;
                ">编辑</button>
                <button class="btn-delete-rule" data-rule-id="${rule.id}" style="
                    background: var(--accent-red, #f87171);
                    color: white;
                    border: none;
                    border-radius: var(--border-radius);
                    padding: 6px 12px;
                    cursor: pointer;
                    font-size: 13px;
                ">删除</button>
            </div>
        </div>
    `).join('');
    
    modal.innerHTML = `
        <div style="background: var(--bg-primary); border-radius: var(--border-radius); padding: 24px; max-width: 1000px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3); position: relative;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 1px solid var(--border); padding-bottom: 16px;">
                <h2 style="font-size: 24px; font-weight: 600; color: var(--text-primary); margin: 0;">
                    ⚙️ 关键字识别管理
                </h2>
                <button id="close-recognition-manager-modal" style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--border-radius); padding: 8px 16px; cursor: pointer; color: var(--text-primary); font-size: 14px;" onmouseenter="this.style.background='var(--accent-red)'; this.style.color='white';" onmouseleave="this.style.background='var(--bg-secondary)'; this.style.color='var(--text-primary)';">
                    关闭 (ESC)
                </button>
            </div>
            
            <div style="margin-bottom: 16px;">
                <button id="add-new-rule-btn" style="
                    background: var(--accent-green, #4ade80);
                    color: white;
                    border: none;
                    border-radius: var(--border-radius);
                    padding: 10px 20px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                " onmouseenter="this.style.opacity='0.8';" onmouseleave="this.style.opacity='1';">
                    ➕ 新增规则
                </button>
            </div>
            
            <div id="recognition-rules-list">
                ${rulesListHtml || '<div style="text-align: center; padding: 40px; color: var(--text-muted);">暂无规则</div>'}
            </div>
        </div>
    `;
    
    // 绑定事件
    bindManagerEvents(modal, rules);
}

/**
 * 绑定管理面板事件
 * @param {HTMLElement} modal - 模态框元素
 * @param {Array} rules - 规则数组
 */
function bindManagerEvents(modal, rules) {
    // 关闭按钮
    const closeBtn = document.getElementById('close-recognition-manager-modal');
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
    
    // 新增规则按钮
    const addBtn = document.getElementById('add-new-rule-btn');
    if (addBtn) {
        addBtn.onclick = () => {
            showRuleEditDialog(modal, null, rules);
        };
    }
    
    // 编辑规则按钮
    const editButtons = modal.querySelectorAll('.btn-edit-rule');
    editButtons.forEach(btn => {
        btn.onclick = () => {
            const ruleId = btn.dataset.ruleId;
            const rule = rules.find(r => r.id === ruleId);
            if (rule) {
                showRuleEditDialog(modal, rule, rules);
            }
        };
    });
    
    // 删除规则按钮
    const deleteButtons = modal.querySelectorAll('.btn-delete-rule');
    deleteButtons.forEach(btn => {
        btn.onclick = async () => {
            const ruleId = btn.dataset.ruleId;
            const rule = rules.find(r => r.id === ruleId);
            if (rule) {
                if (confirm(`确定要删除规则"${rule.title}"吗？`)) {
                    try {
                        await deleteRecognitionRule(ruleId);
                        // 重新加载面板
                        const updatedRules = await getAllRecognitionRules();
                        renderManagerPanel(modal, updatedRules);
                    } catch (err) {
                        alert('删除失败: ' + err.message);
                    }
                }
            }
        };
    });
}

/**
 * 显示规则编辑对话框
 * @param {HTMLElement} modal - 模态框元素
 * @param {object|null} rule - 要编辑的规则（null表示新增）
 * @param {Array} rules - 当前规则数组
 */
function showRuleEditDialog(modal, rule, rules) {
    const isEdit = rule !== null;
    const dialog = document.createElement('div');
    dialog.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.9);
        z-index: 10002;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
    `;
    
    dialog.innerHTML = `
        <div style="background: var(--bg-primary); border-radius: var(--border-radius); padding: 24px; max-width: 600px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
            <h3 style="margin: 0 0 20px 0; font-size: 20px; color: var(--text-primary);">
                ${isEdit ? '编辑规则' : '新增规则'}
            </h3>
            
            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 6px; font-size: 14px; color: var(--text-primary); font-weight: 500;">
                    标题
                </label>
                <input type="text" id="rule-title-input" value="${rule ? escapeHtml(rule.title) : ''}" placeholder="输入规则标题" style="
                    width: 100%;
                    padding: 10px;
                    border: 1px solid var(--border);
                    border-radius: var(--border-radius);
                    background: var(--bg-secondary);
                    color: var(--text-primary);
                    font-size: 14px;
                    box-sizing: border-box;
                ">
            </div>
            
            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 6px; font-size: 14px; color: var(--text-primary); font-weight: 500;">
                    开头标识
                </label>
                <input type="text" id="rule-start-input" value="${rule ? escapeHtml(rule.startSymbol) : ''}" placeholder="例如: &lt;&lt;" style="
                    width: 100%;
                    padding: 10px;
                    border: 1px solid var(--border);
                    border-radius: var(--border-radius);
                    background: var(--bg-secondary);
                    color: var(--text-primary);
                    font-size: 14px;
                    box-sizing: border-box;
                ">
            </div>
            
            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 6px; font-size: 14px; color: var(--text-primary); font-weight: 500;">
                    结尾标识
                </label>
                <input type="text" id="rule-end-input" value="${rule ? escapeHtml(rule.endSymbol) : ''}" placeholder="例如: &gt;&gt;" style="
                    width: 100%;
                    padding: 10px;
                    border: 1px solid var(--border);
                    border-radius: var(--border-radius);
                    background: var(--bg-secondary);
                    color: var(--text-primary);
                    font-size: 14px;
                    box-sizing: border-box;
                ">
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: flex; align-items: center; cursor: pointer;">
                    <input type="checkbox" id="rule-enabled-input" ${rule && (rule.enabled === true || rule.enabled === 'true' || rule.enabled === '是' || rule.enabled === '1' || rule.enabled === 'yes') ? 'checked' : ''} style="
                        width: 18px;
                        height: 18px;
                        margin-right: 8px;
                        cursor: pointer;
                    ">
                    <span style="font-size: 14px; color: var(--text-primary);">是否开启识别</span>
                </label>
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 6px; font-size: 14px; color: var(--text-primary); font-weight: 500;">
                    功能描述
                </label>
                <textarea id="rule-function-description-input" placeholder="输入此规则的功能描述，用于指导AI如何使用此关键字识别格式" style="
                    width: 100%;
                    padding: 10px;
                    border: 1px solid var(--border);
                    border-radius: var(--border-radius);
                    background: var(--bg-secondary);
                    color: var(--text-primary);
                    font-size: 14px;
                    box-sizing: border-box;
                    min-height: 80px;
                    resize: vertical;
                    font-family: inherit;
                ">${rule ? escapeHtml(rule.functionDescription || '') : ''}</textarea>
            </div>
            
            <div style="display: flex; gap: 12px; justify-content: flex-end;">
                <button id="cancel-rule-edit" style="
                    background: var(--bg-secondary);
                    color: var(--text-primary);
                    border: 1px solid var(--border);
                    border-radius: var(--border-radius);
                    padding: 10px 20px;
                    cursor: pointer;
                    font-size: 14px;
                ">取消</button>
                <button id="save-rule-edit" style="
                    background: var(--accent-blue);
                    color: white;
                    border: none;
                    border-radius: var(--border-radius);
                    padding: 10px 20px;
                    cursor: pointer;
                    font-size: 14px;
                ">保存</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    
    // 绑定事件
    const cancelBtn = dialog.querySelector('#cancel-rule-edit');
    const saveBtn = dialog.querySelector('#save-rule-edit');
    
    cancelBtn.onclick = () => {
        document.body.removeChild(dialog);
    };
    
    saveBtn.onclick = async () => {
        const title = dialog.querySelector('#rule-title-input').value.trim();
        const startSymbol = dialog.querySelector('#rule-start-input').value.trim();
        const endSymbol = dialog.querySelector('#rule-end-input').value.trim();
        const enabled = dialog.querySelector('#rule-enabled-input').checked;
        const functionDescription = dialog.querySelector('#rule-function-description-input').value.trim();
        
        if (!title) {
            alert('请输入规则标题');
            return;
        }
        
        if (!startSymbol || !endSymbol) {
            alert('请输入开头标识和结尾标识');
            return;
        }
        
        try {
            if (isEdit) {
                await updateRecognitionRule(rule.id, {
                    title,
                    startSymbol,
                    endSymbol,
                    enabled,
                    functionDescription
                });
            } else {
                await addRecognitionRule({
                    title,
                    startSymbol,
                    endSymbol,
                    enabled,
                    functionDescription
                });
            }
            
            // 重新加载面板
            const updatedRules = await getAllRecognitionRules();
            renderManagerPanel(modal, updatedRules);
            
            // 关闭对话框
            document.body.removeChild(dialog);
        } catch (err) {
            alert('保存失败: ' + err.message);
        }
    };
    
    // ESC键关闭
    const handleEsc = (e) => {
        if (e.key === 'Escape' && document.body.contains(dialog)) {
            document.body.removeChild(dialog);
            document.removeEventListener('keydown', handleEsc);
        }
    };
    document.addEventListener('keydown', handleEsc);
}

/**
 * HTML转义
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 编辑规则
 * @param {string} ruleId - 规则ID
 */
export async function editKeywordRecognitionRule(ruleId) {
    const rules = await getAllRecognitionRules();
    const rule = rules.find(r => r.id === ruleId);
    if (rule) {
        selectRule(rule);
    }
}

/**
 * 删除规则
 * @param {string} ruleId - 规则ID
 */
export async function deleteKeywordRecognitionRule(ruleId) {
    const rules = await getAllRecognitionRules();
    const rule = rules.find(r => r.id === ruleId);
    if (!rule) return;
    
    if (confirm(`确定要删除规则"${rule.title}"吗？`)) {
        try {
            await deleteRecognitionRule(ruleId);
            // 重新加载面板
            const updatedRules = await getAllRecognitionRules();
            renderRulesList(updatedRules);
            updateEnabledRulesCount(updatedRules);
            if (currentEditingRule && currentEditingRule.id === ruleId) {
                await resetRuleForm();
            }
        } catch (err) {
            alert('删除失败: ' + err.message);
        }
    }
}

/**
 * 保存规则
 */
export async function saveKeywordRecognitionRule() {
    const titleInput = document.getElementById('keyword-recognition-rule-title');
    const startSymbolInput = document.getElementById('keyword-recognition-rule-start-symbol');
    const endSymbolInput = document.getElementById('keyword-recognition-rule-end-symbol');
    const enabledInput = document.getElementById('keyword-recognition-rule-enabled');
    const descriptionInput = document.getElementById('keyword-recognition-rule-description');
    
    if (!titleInput || !startSymbolInput || !endSymbolInput || !enabledInput || !descriptionInput) {
        alert('表单元素不存在');
        return;
    }
    
    const title = titleInput.value.trim();
    const startSymbol = startSymbolInput.value.trim();
    const endSymbol = endSymbolInput.value.trim();
    const enabled = enabledInput.checked;
    const functionDescription = descriptionInput.value.trim();
    
    if (!title) {
        alert('请输入规则标题');
        return;
    }
    
    if (!startSymbol || !endSymbol) {
        alert('请输入开头标识和结尾标识');
        return;
    }
    
    try {
        if (currentEditingRule) {
            await updateRecognitionRule(currentEditingRule.id, {
                title,
                startSymbol,
                endSymbol,
                enabled,
                functionDescription
            });
        } else {
            await addRecognitionRule({
                title,
                startSymbol,
                endSymbol,
                enabled,
                functionDescription
            });
        }
        
        // 重新加载面板
        const updatedRules = await getAllRecognitionRules();
        renderRulesList(updatedRules);
        updateEnabledRulesCount(updatedRules);
        await resetRuleForm();
    } catch (err) {
        alert('保存失败: ' + err.message);
    }
}

/**
 * 新建规则
 */
export async function newKeywordRecognitionRule() {
    await resetRuleForm();
    // 清空代码编辑器
    const codeInput = document.getElementById('keyword-recognition-function-code-input');
    if (codeInput) {
        codeInput.value = '';
    }
    // 显示保存按钮
    const saveBtn = document.getElementById('save-keyword-recognition-rule');
    if (saveBtn) saveBtn.style.display = 'flex';
}

/**
 * 取消编辑
 */
export async function cancelKeywordRecognitionEdit() {
    await resetRuleForm();
}

/**
 * 扫描文件中的已有资源（函数、变量、常量等）
 * @param {string} fileContent - 文件内容
 * @returns {object} 包含已导出函数、内部函数、工具函数等信息
 */
async function scanExistingResources() {
    try {
        const { getFile } = await import('../../core/api.js');
        const fileContent = await getFile('js/modules/usage/keywordRecognitionManager.js');
        
        if (!fileContent) {
            return {
                exportedFunctions: [],
                internalFunctions: [],
                toolFunctions: [],
                constants: [],
                userCodeFunctions: []
            };
        }
        
        const exportedFunctions = [];
        const internalFunctions = [];
        const toolFunctions = [];
        const constants = [];
        const variables = [];
        
        // 扫描导出的函数
        const exportFunctionPattern = /^export\s+(?:async\s+)?function\s+(\w+)/gm;
        let match;
        while ((match = exportFunctionPattern.exec(fileContent)) !== null) {
            const funcName = match[1];
            if (funcName && !funcName.includes('process') && !funcName.includes('Recognition')) {
                exportedFunctions.push(funcName);
            }
        }
        
        // 扫描导出的常量
        const exportConstPattern = /^export\s+const\s+(\w+)/gm;
        while ((match = exportConstPattern.exec(fileContent)) !== null) {
            constants.push(match[1]);
        }
        
        // 扫描内部函数（非导出的function）
        const internalFunctionPattern = /^function\s+(\w+)/gm;
        while ((match = internalFunctionPattern.exec(fileContent)) !== null) {
            const funcName = match[1];
            // 识别工具函数
            if (funcName === 'escapeHtml' || funcName === 'escapeRegex' || 
                funcName === 'extractUserCodeBlocks' || funcName === 'extractExportedFunctions' ||
                funcName === 'getFileLineCount' || funcName === 'getFunctionLineNumber') {
                toolFunctions.push(funcName);
            } else {
                internalFunctions.push(funcName);
            }
        }
        
        // 扫描顶层常量
        const constPattern = /^const\s+(\w+)/gm;
        while ((match = constPattern.exec(fileContent)) !== null) {
            const constName = match[1];
            if (constName !== 'match' && constName !== 'err') {
                constants.push(constName);
            }
        }
        
        // 扫描用户代码块中已存在的函数（避免重复）
        const userCodeBlocks = extractUserCodeBlocks(fileContent);
        const userCodeFunctions = new Set();
        userCodeBlocks.forEach(block => {
            const functions = extractExportedFunctions(block.code);
            functions.forEach(func => userCodeFunctions.add(func));
        });
        
        return {
            exportedFunctions: [...new Set(exportedFunctions)].sort(),
            internalFunctions: [...new Set(internalFunctions)].sort(),
            toolFunctions: [...new Set(toolFunctions)].sort(),
            constants: [...new Set(constants)].sort(),
            userCodeFunctions: Array.from(userCodeFunctions).sort()
        };
    } catch (err) {
        console.error('[关键字识别] 扫描已有资源失败:', err);
        return {
            exportedFunctions: [],
            internalFunctions: [],
            toolFunctions: [],
            constants: [],
            userCodeFunctions: []
        };
    }
}

/**
 * 显示功能函数生成模板
 */
export async function showKeywordRecognitionFunctionTemplate() {
    try {
        const panel = document.getElementById('keyword-recognition-function-template-panel');
        const content = document.getElementById('keyword-recognition-function-template-content');
        const templateBtn = document.getElementById('keyword-recognition-function-template-btn');
        
        if (!panel || !content) {
            console.error('[关键字识别管理] 模板面板或内容元素不存在');
            return;
        }
        
        // 显示面板并设置按钮激活状态
        panel.style.display = 'block';
        if (templateBtn) {
            templateBtn.classList.add('btn-active');
        }
        
        // 获取当前编辑的规则信息
        const titleInput = document.getElementById('keyword-recognition-rule-title');
        const startSymbolInput = document.getElementById('keyword-recognition-rule-start-symbol');
        const endSymbolInput = document.getElementById('keyword-recognition-rule-end-symbol');
        const descriptionInput = document.getElementById('keyword-recognition-rule-description');
        
        // 获取当前编辑规则的ID
        const ruleId = currentEditingRule ? currentEditingRule.id : 'rule_example_id';
        
        const currentRule = {
            title: titleInput ? titleInput.value.trim() : '',
            startSymbol: startSymbolInput ? startSymbolInput.value.trim() : '',
            endSymbol: endSymbolInput ? endSymbolInput.value.trim() : '',
            functionDescription: descriptionInput ? descriptionInput.value.trim() : '',
            id: ruleId
        };
        
        // 转义特殊字符用于模板字符串
        const escapeForTemplate = (str) => {
            if (!str) return '';
            return str.replace(/\\/g, '\\\\').replace(/\`/g, '\\`').replace(/\$/g, '\\$');
        };
        
        const ruleTitle = escapeForTemplate(currentRule.title || '当前规则');
        const startSymbol = escapeForTemplate(currentRule.startSymbol || '<<');
        const endSymbol = escapeForTemplate(currentRule.endSymbol || '>>');
        const functionDescription = escapeForTemplate(currentRule.functionDescription || '');
        const escapedRuleId = escapeForTemplate(ruleId);
        
        // 扫描已有资源
        let existingResources;
        try {
            existingResources = await scanExistingResources();
        } catch (err) {
            console.error('[关键字识别管理] 扫描已有资源失败:', err);
            existingResources = {
                exportedFunctions: [],
                internalFunctions: [],
                toolFunctions: [],
                constants: [],
                userCodeFunctions: []
            };
        }
        
        // 构建系统已有资源说明
        const buildExistingResourcesSection = () => {
        let section = `## ⚠️ 系统已有资源（避免冲突）\n\n`;
        section += `**重要：生成代码时请避免使用以下已有的函数名、变量名和常量名，以免造成冲突！**\n\n`;
        
        if (existingResources.exportedFunctions.length > 0) {
            section += `### 已导出的函数（可直接使用，但不要重新定义）：\n`;
            section += existingResources.exportedFunctions.map(f => `- \`${f}\``).join('\n') + '\n\n';
        }
        
        if (existingResources.toolFunctions.length > 0) {
            section += `### 系统工具函数（可直接使用，无需重新定义）：\n`;
            existingResources.toolFunctions.forEach(f => {
                if (f === 'escapeHtml') {
                    section += `- \`escapeHtml(text)\` - HTML转义函数，已存在于系统中，可以直接使用（但不要导出同名函数）\n`;
                } else if (f === 'escapeRegex') {
                    section += `- \`escapeRegex(str)\` - 正则表达式转义函数，已在系统中存在，可以直接使用（但不要导出同名函数）\n`;
                } else {
                    section += `- \`${f}\` - 可以直接调用，无需导入\n`;
                }
            });
            section += `\n**特别说明：**如果需要使用这些工具函数，请在函数内部定义为局部函数，或者直接调用（如果是全局可访问的）。\n\n`;
        }
        
        if (existingResources.userCodeFunctions.length > 0) {
            section += `### 用户代码块中已存在的函数（避免重复定义）：\n`;
            section += existingResources.userCodeFunctions.map(f => `- \`${f}\``).join('\n') + '\n\n';
        }
        
        if (existingResources.constants.length > 0) {
            section += `### 系统常量（避免使用相同名称）：\n`;
            const constantsToShow = existingResources.constants.slice(0, 20);
            section += constantsToShow.map(c => `- \`${c}\``).join('\n');
            if (existingResources.constants.length > 20) {
                section += `\n（还有 ${existingResources.constants.length - 20} 个常量...）`;
            }
            section += '\n\n';
        }
        
        section += `### 注意事项：\n\n`;
        section += `1. **不要导出与系统函数同名的函数**：如果系统已有 \`escapeHtml\` 等工具函数，你的代码中可以使用，但不要使用 \`export function escapeHtml\` 重新导出，这会导致冲突。\n\n`;
        section += `2. **函数作用域建议**：工具函数（如 \`escapeHtml\`, \`escapeRegex\`）建议在需要使用它们的函数内部定义为局部函数，这样不会与系统函数冲突。\n\n`;
        section += `3. **命名建议**：\n`;
        section += `   - 主处理函数使用标准命名：\`process\${规则标题}Recognition\`\n`;
        section += `   - 辅助函数使用描述性名称，避免与系统函数冲突\n`;
        section += `   - 建议使用动词开头：\`validate\`、\`process\`、\`save\`、\`format\` 等\n\n`;
        section += `4. **导入路径规则（非常重要）**：\n`;
        section += `   生成的函数文件会保存在 \`js/modules/usage/keywordRecognitionFunctions/\` 子目录中。\n`;
        section += `   导入其他模块时，需要根据目标模块的位置计算正确的相对路径：\n\n`;
        section += `   **路径计算规则**：\n`;
        section += `   - 函数文件位置：\`js/modules/usage/keywordRecognitionFunctions/你的函数.js\`\n`;
        section += `   - 同级目录（\`js/modules/usage/\`）：使用 \`../模块名.js\`\n`;
        section += `   - 父级目录（\`js/modules/\`）：使用 \`../../模块名.js\`\n`;
        section += `   - 核心目录（\`js/core/\`）：使用 \`../../core/模块名.js\`\n\n`;
        section += `   **常用模块导入路径对照表**：\n`;
        section += `   \`\`\`javascript\n`;
        section += `   // 同级目录的模块（js/modules/usage/）\n`;
        section += `   const { getAllRecognitionRules } = await import('../keywordRecognitionManager.js');\n`;
        section += `   const { extractKeywords } = await import('../keywordStats.js');\n`;
        section += `   const { showKeywordStatsModal } = await import('../usageDisplay.js');\n\n`;
        section += `   // 父级目录的模块（js/modules/）\n`;
        section += `   const { executeWorkflowStep } = await import('../../workflowManager.js');\n`;
        section += `   const { sendMessage } = await import('../../aiService.js');\n\n`;
        section += `   // 核心API（js/core/）\n`;
        section += `   const { getFile, saveFile } = await import('../../core/api.js');\n`;
        section += `   \`\`\`\n\n`;
        section += `   **错误示例（会导致404错误）**：\n`;
        section += `   - \`await import('./keywordRecognitionManager.js')\` ❌\n`;
        section += `   - \`await import('./workflowManager.js')\` ❌\n`;
        section += `   - \`await import('../core/api.js')\` ❌\n\n`;
        section += `   **正确示例**：\n`;
        section += `   - \`await import('../keywordRecognitionManager.js')\` ✅\n`;
        section += `   - \`await import('../../workflowManager.js')\` ✅\n`;
        section += `   - \`await import('../../core/api.js')\` ✅\n\n`;
        
        return section;
    };
    
    const existingResourcesSection = buildExistingResourcesSection();
    
    // 动态获取文件位置信息
    const template = `# 关键字识别管理功能函数生成模板

## 📋 当前规则信息

**规则标题**: ${ruleTitle || '未设置'}
**开头标识**: ${startSymbol || '未设置'}
**结尾标识**: ${endSymbol || '未设置'}
**功能描述**: ${functionDescription || '未设置'}

${functionDescription ? `\n**功能说明**: ${functionDescription}\n` : ''}

${existingResourcesSection}

## 🎯 任务说明

**重要：你只需要生成一个处理函数（process函数），不需要生成检测函数（detect函数）！**

系统已经有通用的 detectKeywordRecognition 函数用于检测关键字，你只需要生成对应的处理函数，该函数在系统检测到关键字后会被自动调用。

你需要为上述规则生成一个处理函数，该函数能够：
1. 接收系统检测到的关键字信息（包括AI回复内容、规则ID、关键字数组、匹配详情）
2. 根据功能描述执行相应的业务逻辑
3. 返回处理结果（必须包含 success 字段表示是否成功）

## 📚 项目代码风格参考

以下是项目中实际使用的检测函数代码，请严格按照这个风格编写：

\\\`\\\`\\\`javascript
/**
 * 检测工作流控制指令
 * @param {string} message - AI回复的消息内容
 * @param {boolean} validateWorkflow - 是否验证工作流名称，默认true
 * @returns {object|null} 检测结果 {action: 'terminate'|'continue', workflowName: string} 或 null
 */
function detectWorkflowControl(message, validateWorkflow = true) {
    if (!message) return null;
    
    // 检测终止工作流：支持多种写法
    const terminatePatterns = [
        /终止工作流[：:：:]\s*([^\\n\\r]+)?/i,
        /stop\\s+workflow[：:：:]\s*([^\\n\\r]+)?/i,
        /terminate\\s+workflow[：:：:]\s*([^\\n\\r]+)?/i,
        /<终止工作流[^>]*>([^<]+)?<\\/终止工作流>/i,
        /\\\`\\\`\\\`workflow-control\\s+terminate\\s+([^\\\`]+)?\\\`\\\`\\\`/i
    ];
    
    // 检测继续工作流
    const continuePatterns = [
        /继续工作流[：:：:]\s*([^\\n\\r]+)/i,
        /continue\\s+workflow[：:：:]\s*([^\\n\\r]+)/i,
        /resume\\s+workflow[：:：:]\s*([^\\n\\r]+)/i,
        /<继续工作流[^>]*>([^<]+)<\\/继续工作流>/i,
        /\\\`\\\`\\\`workflow-control\\s+continue\\s+([^\\\`]+)\\\`\\\`\\\`/i
    ];
    
    for (const pattern of terminatePatterns) {
        const match = message.match(pattern);
        if (match) {
            const workflowName = match[1] ? match[1].trim() : null;
            return { action: 'terminate', workflowName };
        }
    }
    
    for (const pattern of continuePatterns) {
        const match = message.match(pattern);
        if (match) {
            let workflowName = match[1] ? match[1].trim() : null;
            // 去除可能的加粗标记（**）和其他格式标记
            if (workflowName) {
                workflowName = workflowName.replace(/\\*\\*/g, '').trim();
                workflowName = workflowName.replace(/^[0-9]+\\.\\s*/, '').trim();
            }
            
            // 如果启用验证，在工作流列表中查找匹配的工作流
            let matchedWorkflowName = null;
            if (validateWorkflow && workflowName) {
                matchedWorkflowName = findWorkflowInList(workflowName);
                if (matchedWorkflowName) {
                    workflowName = matchedWorkflowName;
                }
            }
            
            return { 
                action: 'continue', 
                workflowName: workflowName,
                matchedWorkflowName: matchedWorkflowName,
                isValid: validateWorkflow ? (matchedWorkflowName !== null) : true
            };
        }
    }
    
    return null;
}
\\\`\\\`\\\`

## 🔧 代码生成要求

### 1. 函数命名

**主处理函数命名格式（重要！）：**
- process\${规则标题处理后的名称}Recognition

**规则标题处理规则（必须严格遵守）：**
1. **如果规则标题包含汉字**：将每个汉字转换成对应的拼音（小写），然后用下划线连接
   - 例如：规则标题是"默认关键字识别"，则函数名是 process_mo_ren_guan_jian_zi_shi_bieRecognition
   - 例如：规则标题是"时间戳弹窗"，则函数名是 process_shi_jian_chuo_tan_chuangRecognition
   - 例如：规则标题是"默认关键字识别2"，则函数名是 process_mo_ren_guan_jian_zi_shi_bie_2Recognition

2. **如果规则标题不包含汉字**：去除所有特殊字符（保留字母、数字），直接使用
   - 例如：规则标题是"Keyword Recognition 2"，则函数名是 processKeywordRecognition2Recognition

3. **混合情况**：汉字部分转拼音，非汉字部分保留（去除特殊字符）
   - 例如：规则标题是"默认Keyword识别"，则函数名是 process_mo_ren_Keyword_shi_bieRecognition

**重要提示：**
- 系统会根据规则ID从保存的函数文件中直接读取函数名，不会根据规则标题重新生成
- 因此，你必须严格按照上述规则生成函数名，确保函数名与规则标题的对应关系清晰可辨
- 如果函数名不正确，系统将无法找到并调用你的函数

**重要提示：你可以定义多个函数！**

系统会按以下优先级查找函数：
1. **标准函数名**：优先查找 process\${规则标题}Recognition 格式的函数
2. **用户代码块中的函数**：如果标准函数不存在，系统会自动扫描你代码块中所有导出的函数（export function），优先选择名称包含 process 和 Recognition 的函数

这意味着你可以：
- 定义主处理函数（必须使用标准命名）
- 定义辅助函数、工具函数、数据验证函数等（使用任意命名，但建议使用 export 导出）
- 实现复杂的业务逻辑，通过多个函数协作完成

**示例：你可以这样组织代码：**
\\\`\\\`\\\`javascript
// 主处理函数（标准命名，系统会优先调用）
// 函数名格式：process + 规则标题（汉字转拼音，每个字拼音_拼接）+ Recognition
// 例如：规则标题"默认关键字识别" → process_mo_ren_guan_jian_zi_shi_bieRecognition
export async function process\${规则标题处理后的名称（汉字转拼音）}Recognition(aiContent, ruleId, keywords, matches) {
    // 重要：主函数应该充分利用辅助函数，避免重复代码
    // 调用辅助函数进行处理
    const validatedKeywords = validateKeywords(keywords);
    const processedData = await processKeywordsData(validatedKeywords);
    const result = await saveKeywordsToDatabase(processedData);
    
    // 返回处理结果
    return result;
}

/**
 * 辅助函数：验证关键字内容
 * @param {Array<string>} keywords - 关键字数组
 * @returns {Array<string>} 验证后的关键字数组
 */
export function validateKeywords(keywords) {
    return keywords.filter(k => k && k.trim().length > 0);
}

/**
 * 辅助函数：处理关键字数据
 * @param {Array<string>} keywords - 验证后的关键字数组
 * @returns {Promise<object>} 处理后的数据
 */
export async function processKeywordsData(keywords) {
    // 处理逻辑...
    return processedData;
}

/**
 * 辅助函数：保存到数据库
 * @param {object} data - 要保存的数据
 * @returns {Promise<object>} 保存结果，包含success字段
 */
export async function saveKeywordsToDatabase(data) {
    // 保存逻辑...
    return { success: true };
}
\\\`\\\`\\\`

**关键点：**
- 主处理函数必须使用标准命名格式，这样系统才能自动找到它
- 辅助函数可以使用任意名称，但必须使用 export 导出，系统才能扫描到
- **重要：如果你定义了辅助函数，主处理函数应该调用它们，而不是重复实现相同逻辑**（遵循DRY原则：Don't Repeat Yourself）
- **所有函数（包括辅助函数）都必须包含完整的JSDoc注释**，使用 \`/** ... */\` 格式，包含函数说明、@param 和 @returns 标签
- 如果主处理函数不存在，系统会从你导出的所有函数中自动选择最合适的（优先选择名称包含 process 和 Recognition 的函数）

**代码组织最佳实践：**
1. **函数职责分离**：主处理函数负责协调和组织整个处理流程，辅助函数负责具体的业务逻辑
2. **避免重复代码**：如果需要在多个地方使用相同的逻辑，应该提取为辅助函数并在主函数中调用
3. **函数调用关系**：主函数应该调用辅助函数来完成工作，而不是在主函数中重复实现辅助函数的功能
4. **代码可读性**：通过合理的函数拆分，让代码更容易理解和维护

**不需要生成检测函数！** 系统已有通用的 detectKeywordRecognition 函数。

### 2. 函数签名（重要！）

**⚠️ 必须生成完整的函数声明，包括 export、async、function 关键字和函数体！不要只生成函数体代码！**

**⚠️ 函数命名规则（非常重要）：**
- 如果规则标题包含汉字，必须将每个汉字转换成对应的拼音（小写），然后用下划线连接
- 例如：规则标题"默认关键字识别" → 函数名 process_mo_ren_guan_jian_zi_shi_bieRecognition
- 例如：规则标题"时间戳弹窗" → 函数名 process_shi_jian_chuo_tan_chuangRecognition
- 系统会根据规则ID从保存的函数文件中直接读取函数名，不会根据规则标题重新生成，所以函数名必须正确

处理函数必须使用以下完整签名：
\\\`\\\`\\\`javascript
/**
 * 处理${ruleTitle || '当前规则'}规则的关键字
 * 功能：${functionDescription || '处理检测到的关键字'}
 * @param {string} aiContent - AI回复的完整文本内容（包含所有原始文本，可用于提取上下文）
 * @param {string} ruleId - 规则ID（唯一标识符）
 * @param {Array<string>} keywords - 检测到的关键字数组（已去除标记符号，只包含关键字内容）
 * @param {Array<object>} matches - 匹配详情数组，每个对象包含：
 *   - keyword: string - 关键字内容（已去除标记符号）
 *   - fullMatch: string - 完整匹配文本（包含标记符号，如 <<<关键字>>>）
 *   - index: number - 关键字在aiContent中的位置索引
 *   - ruleId: string - 规则ID
 *   - ruleTitle: string - 规则标题
 * @returns {Promise<object>} 处理结果，必须包含 success 字段（boolean）表示是否成功
 */
export async function process\${规则标题处理后的名称}Recognition(aiContent, ruleId, keywords, matches) {
    // 函数实现代码
    // 注意：必须包含完整的函数体，不能只有注释
}
\\\`\\\`\\\`

**⚠️ 重要提醒：**
- 必须包含 \`export async function\` 关键字
- 必须包含完整的函数名
- 必须包含完整的参数列表 \`(aiContent, ruleId, keywords, matches)\`
- 必须包含函数体 \`{ ... }\`
- 不要只生成函数体内部的代码，必须生成完整的函数声明！

**参数说明（重要）：**
- **系统已经完成了关键字检测**：系统在调用你的 \`process\` 函数之前，已经通过 \`detectKeywordRecognition\` 函数检测了关键字。你**不需要**再次调用检测函数，只需要处理已经检测到的关键字。
- \`keywords\` 参数已经是提取后的关键字内容，**不包含标记符号**。例如，如果AI回复是 \`<<<测试>>>\`，那么 \`keywords\` 数组中会是 \`['测试']\`，而不是 \`['<<<测试>>>']\`。
- 如果需要获取包含标记符号的完整文本，可以使用 \`matches\` 数组中的 \`fullMatch\` 字段。
- \`aiContent\` 包含完整的AI回复文本，可以用于提取关键字的上下文信息。
- \`matches\` 数组提供了每个关键字的详细信息，包括在原文中的位置，可以用于高亮显示或上下文提取。
- **不要重复检测**：你的函数只需要处理已经检测到的关键字，不需要再次调用 \`detectKeywordRecognition\` 或类似的检测函数。

**代码复杂度建议：**
- 对于简单的功能（如弹出提示、记录日志），主函数可以直接实现，不需要过度拆分
- 对于复杂功能（如数据处理、文件操作、网络请求），建议拆分为多个辅助函数
- 避免为了拆分而拆分，保持代码简洁和可读性
- 如果功能确实简单，一个主函数就足够了，不需要强制定义多个辅助函数

**返回值格式要求：**
\\\`\\\`\\\`javascript
{
    success: boolean,         // 必须包含此字段，表示处理是否成功
    message?: string,         // 可选的提示信息
    // 可以添加其他自定义字段
}
\\\`\\\`\\\`

### 3. 正则表达式模式

开头标识: \`${startSymbol}\`
结尾标识: \`${endSymbol}\`

请使用以下方式构建正则表达式：
\\\`\\\`\\\`javascript
// 转义特殊字符

.js\` 文件中。所有函数都在同一个文件中，可以互相调用。

这意味着：
- 你只需要提供完整的代码（包含所有函数）
- 所有函数会被保存到同一个文件中（例如 \`rule_rule_1767156799205_vw3xfvtqg.js\`）
- 由于所有函数在同一个文件中，它们可以互相调用，不需要导入（不需要使用 import 语句导入辅助函数）
- 主函数可以直接调用辅助函数，如 \`validateKeywords(keywords)\`、\`generateTimestampInfo()\` 等
- 函数之间的依赖关系会自动处理

### 5. 导出方式

使用 export function 或 export async function

## 📝 完整代码模板

请参考以下模板生成完整代码（注意：这是process函数的模板，不是detect函数！）：

\\\`\\\`\\\`javascript
/**
 * 处理$

规则
 * ${functionDescription ? `功能: ${functionDescription}` : '从AI回复中检测关键字识别格式'}
 * @param {string} aiContent - AI回复的完整文本内容
 * @param {string} ruleId - 规则ID
 * @param {Array<string>} keywords - 检测到的关键字数组
 * @param {Array<object>} matches - 匹配详情数组
 * @returns {Promise<object>} 处理结果，必须包含 success 字段
 */
// 注意：函数名必须根据规则标题生成，如果规则标题包含汉字，需要将每个汉字转换成拼音（小写），然后用下划线连接
// 例如：规则标题"默认关键字识别" → 函数名 process_mo_ren_guan_jian_zi_shi_bieRecognition
// 系统会根据规则ID从保存的函数文件中直接读取函数名，不会根据规则标题重新生成，所以函数名必须正确
export async function process\${规则标题处理后的名称（汉字转拼音，每个字拼音_拼接）}Recognition(aiContent, ruleId, keywords, matches) {
    console.log(\`[关键字识别-${ruleTitle || '当前规则'}] 开始处理关键字，规则ID: \${ruleId}\`);
    
    try {
        // 参数验证
        if (!aiContent || typeof aiContent !== 'string') {
            console.warn(\`[关键字识别-${ruleTitle || '当前规则'}] AI内容为空或格式不正确\`);
            return { success: false, message: 'AI内容为空或格式不正确' };
        }
        
        if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
            console.warn(\`[关键字识别-${ruleTitle || '当前规则'}] 关键字数组为空\`);
            return { success: false, message: '关键字数组为空' };
        }
        
        // 获取规则信息（注意：函数文件保存在 keywordRecognitionFunctions/ 子目录中，需要使用 ../ 导入父目录的模块）
        const { getAllRecognitionRules } = await import('../keywordRecognitionManager.js');
        const rules = await getAllRecognitionRules();
        const rule = rules.find(r => r.id === ruleId);
        
        if (!rule) {
            console.warn(\`[关键字识别-${ruleTitle || '当前规则'}] 规则 \${ruleId} 不存在\`);
            return { success: false, message: \`规则 \${ruleId} 不存在\` };
        }
        
        console.log(\`[关键字识别-${ruleTitle || '当前规则'}] 规则信息: \${rule.title}\`);
        console.log(\`[关键字识别-${ruleTitle || '当前规则'}] 关键字列表:\`, keywords);
        
        // 在这里实现你的业务逻辑
        // 如果功能复杂，可以定义辅助函数并在主函数中调用
        
        return {
            success: true,
            message: \`成功处理 \${keywords.length} 个关键字\`,
            keywords: keywords
        };
    } catch (err) {
        console.error(\`[关键字识别-${ruleTitle || '当前规则'}] 处理失败:\`, err);
        return {
            success: false,
            message: '处理关键字时发生错误',
            error: err.message
        };
    }
}

/**
 * 辅助函数示例：验证关键字内容
 * @param {Array<string>} keywords - 关键字数组
 * @returns {Array<string>} 验证后的关键字数组
 */
export function validateKeywords(keywords) {
    if (!keywords || !Array.isArray(keywords)) {
        return [];
    }
    return keywords.filter(k => k && k.trim().length > 0);
}

/**
 * 辅助函数示例：格式化数据
 * @param {object} data - 原始数据
 * @returns {object} 格式化后的数据
 */
export function formatData(data) {
    // 格式化逻辑...
    return data;
}
\\\`\\\`\\\`

## ⚠️ 重要提示

1. **严格遵循项目代码风格**：参考 detectWorkflowControl 函数的写法
2. **使用现有的API**：使用 getAllRecognitionRules() 获取规则
3. **错误处理**：必须包含 try-catch 和适当的日志记录
4. **正则转义**：必须转义开头和结尾标识中的特殊字符
5. **导出函数**：使用 export function 或 export async function
6. **JSDoc注释**：**所有函数（包括主函数和辅助函数）都必须包含完整的JSDoc注释**，使用 \`/** ... */\` 格式，包含函数说明、参数说明（@param）和返回值说明（@returns）。注释是代码的重要组成部分，系统会完整保存。
7. **代码保存方式**：同一规则的所有函数（包括主函数和辅助函数）会被保存到同一个文件中。由于所有函数都在同一个文件中，它们可以互相调用，不需要导入。只需提供完整的代码（包含所有函数和注释）即可。
8. **导入路径（非常重要）**：
   - 函数文件保存在 \`keywordRecognitionFunctions/\` 子目录中
   - **路径计算规则**：
     - 同级目录（\`js/modules/usage/\`）：使用 \`../模块名.js\`
     - 父级目录（\`js/modules/\`）：使用 \`../../模块名.js\`
     - 核心目录（\`js/core/\`）：使用 \`../../core/模块名.js\`
   - **常用模块示例**：
     - \`keywordRecognitionManager.js\` → \`../keywordRecognitionManager.js\`
     - \`keywordStats.js\` → \`../keywordStats.js\`
     - \`workflowManager.js\` → \`../../workflowManager.js\`
     - \`core/api.js\` → \`../../core/api.js\`
   - **绝对不要使用 \`./\` 导入同级或父级模块**，这会导致 404 错误！
9. **参数格式理解**：\`keywords\` 参数已经是提取后的内容（不包含标记符号），不需要再次提取。如果需要完整匹配文本，使用 \`matches[i].fullMatch\`
10. **函数协作**：如果定义了辅助函数，主函数必须调用它们，避免重复实现相同逻辑
11. **代码质量**：确保代码清晰、可维护，函数职责分离明确，所有函数都有完整的JSDoc注释

## 📁 文件位置

- **保存目录**: js/modules/usage/keywordRecognitionFunctions/
- **保存方式**: 同一规则的所有函数（包括主函数和辅助函数）保存到同一个文件中（例如 \`rule_\${escapedRuleId}.js\`）
- **函数调用**: 由于所有函数都在同一个文件中，它们可以互相调用，不需要导入。主函数可以直接调用辅助函数，无需使用 import 语句。
- **索引文件**: js/modules/usage/keywordRecognitionFunctions/.index.json（自动管理，无需手动编辑）
- **导入路径规则（非常重要）**：
  - **函数文件位置**：\`js/modules/usage/keywordRecognitionFunctions/你的函数.js\`
  - **路径计算规则**：
    - 同级目录（\`js/modules/usage/\`）：使用 \`../模块名.js\`
    - 父级目录（\`js/modules/\`）：使用 \`../../模块名.js\`
    - 核心目录（\`js/core/\`）：使用 \`../../core/模块名.js\`
  - **常用模块导入路径**：
    - \`keywordRecognitionManager.js\`：\`../keywordRecognitionManager.js\`
    - \`keywordStats.js\`：\`../keywordStats.js\`
    - \`usageDisplay.js\`：\`../usageDisplay.js\`
    - \`workflowManager.js\`：\`../../workflowManager.js\`
    - \`aiService.js\`：\`../../aiService.js\`
    - \`core/api.js\`：\`../../core/api.js\`
  - **常见错误**：使用 \`./\` 导入同级或父级模块会导致 404 错误
- **相关文件**: 
  - js/modules/workflowManager.js (工作流执行逻辑)
  - js/modules/usage/keywordStats.js (关键字统计)
  - js/modules/usage/usageDisplay.js (使用统计显示)
  - js/core/api.js (核心API，包含文件操作函数)

## 🎯 使用方式

生成的函数会在工作流执行时自动调用（在AI回复后），例如：

\\\`\\\`\\\`javascript
// 在工作流执行后检测关键字（自动调用，无需手动调用）
// 位置：js/modules/workflowManager.js 的 executeWorkflowStep 函数返回后
// 系统会自动检测AI回复中的关键字并调用相应的处理函数
\\\`\\\`\\\`

## 📝 日志记录规范

所有函数必须包含详细的日志记录，方便调试和追踪：

\\\`\\\`\\\`javascript
// 注意：函数名必须根据规则标题生成，如果规则标题包含汉字，需要将每个汉字转换成拼音（小写），然后用下划线连接
// 例如：规则标题"默认关键字识别" → 函数名 process_mo_ren_guan_jian_zi_shi_bieRecognition
export async function process\${规则标题处理后的名称（汉字转拼音，每个字拼音_拼接）}Recognition(aiContent, ruleId, keywords, matches) {
    console.log(\`[关键字识别-${ruleTitle || '当前规则'}] 开始处理关键字，规则ID: \${ruleId}\`);
    console.log(\`[关键字识别-${ruleTitle || '当前规则'}] 检测到的关键字数量: \${keywords ? keywords.length : 0}\`);
    
    try {
        // 参数验证日志
        if (!aiContent || typeof aiContent !== 'string') {
            console.warn(\`[关键字识别-${ruleTitle || '当前规则'}] AI内容为空或格式不正确\`);
            return { success: false, message: 'AI内容为空或格式不正确' };
        }
        
        if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
            console.warn(\`[关键字识别-${ruleTitle || '当前规则'}] 关键字数组为空\`);
            return { success: false, message: '关键字数组为空' };
        }
        
        // 获取规则信息（注意：函数文件保存在 keywordRecognitionFunctions/ 子目录中，需要使用 ../ 导入父目录的模块）
        const { getAllRecognitionRules } = await import('../keywordRecognitionManager.js');
        const rules = await getAllRecognitionRules();
        const rule = rules.find(r => r.id === ruleId);
        
        if (!rule) {
            console.warn(\`[关键字识别-${ruleTitle || '当前规则'}] 规则 \${ruleId} 不存在\`);
            return { success: false, message: \`规则 \${ruleId} 不存在\` };
        }
        
        console.log(\`[关键字识别-${ruleTitle || '当前规则'}] 规则信息: \${rule.title}\`);
        console.log(\`[关键字识别-${ruleTitle || '当前规则'}] 关键字列表:\`, keywords);
        
        // 处理逻辑...
        
        console.log(\`[关键字识别-${ruleTitle || '当前规则'}] 处理完成\`);
        
        return {
            success: true,
            message: \`成功处理 \${keywords.length} 个关键字\`,
            keywords: keywords
        };
    } catch (err) {
        console.error(\`[关键字识别-${ruleTitle || '当前规则'}] 处理失败:\`, err);
        console.error(\`[关键字识别-${ruleTitle || '当前规则'}] 错误堆栈:\`, err.stack);
        return {
            success: false,
            message: '处理关键字时发生错误',
            error: err.message
        };
    }
}
\\\`\\\`\\\`

**日志级别说明：**
- \`console.log\`: 正常流程信息（检测开始、找到规则数量、检测结果等）
- \`console.warn\`: 警告信息（规则不存在、数据格式异常等）
- \`console.error\`: 错误信息（异常捕获、函数调用失败等）

**日志格式规范：**
- 所有日志以 \`[关键字识别]\` 或 \`[关键字识别-规则名]\` 开头
- 关键操作必须记录日志（开始检测、找到规则、检测结果、错误等）
- 日志应包含足够的上下文信息（规则ID、关键字内容、匹配数量等）

---

**现在请根据上述模板和当前规则信息，生成完整的处理函数（process函数）代码，确保：**
1. **必须生成完整的函数声明**：包括 \`export async function process\${规则标题处理后的名称}Recognition(aiContent, ruleId, keywords, matches) { ... }\`，不要只生成函数体！
2. **函数名必须是 process\${规则标题处理后的名称}Recognition**（如果规则标题包含汉字，必须将每个汉字转换成拼音（小写），然后用下划线连接）
3. **函数签名必须是 (aiContent, ruleId, keywords, matches)**
4. **返回值必须包含 success 字段（boolean类型）**
5. **包含详细的日志记录**
6. **如果定义了辅助函数，每个辅助函数也必须使用 export 关键字完整声明，主函数必须调用它们**
7. **所有函数都必须有完整的函数声明，包括 export、function 关键字、函数名、参数列表和函数体**
8. **不需要生成检测函数（detect函数）！系统已经完成了关键字检测，你的函数只需要处理已经检测到的关键字，不需要再次调用检测函数。**
9. **导入路径必须正确（非常重要）**：
   - **路径计算规则**：函数文件在 \`keywordRecognitionFunctions/\` 子目录中
     - 同级目录（\`js/modules/usage/\`）：使用 \`../模块名.js\`
     - 父级目录（\`js/modules/\`）：使用 \`../../模块名.js\`
     - 核心目录（\`js/core/\`）：使用 \`../../core/模块名.js\`
   - **常用模块导入路径对照表**：
     - \`keywordRecognitionManager.js\` → \`../keywordRecognitionManager.js\` ✅
     - \`keywordStats.js\` → \`../keywordStats.js\` ✅
     - \`usageDisplay.js\` → \`../usageDisplay.js\` ✅
     - \`workflowManager.js\` → \`../../workflowManager.js\` ✅
     - \`aiService.js\` → \`../../aiService.js\` ✅
     - \`core/api.js\` → \`../../core/api.js\` ✅
   - **绝对不要使用 \`./\` 导入同级或父级模块**（会导致 404 错误）❌

## 📋 模板说明

本模板用于指导AI生成关键字识别管理的功能函数代码。生成的代码将自动集成到关键字识别管理系统中，实现可视化的规则管理功能。

## 🎯 功能概述

关键字识别管理功能允许用户：
- 管理多个关键字识别规则（每个规则包含：标题、开头标识、结尾标识、是否开启）
- 新增、编辑、删除识别规则
- 规则以Markdown格式保存在本地文件
- 规则变更后自动更新缓存，避免频繁读取文件
- 在工作流执行时，自动将启用的识别规则转换为提示词，指导AI使用关键字识别格式

## 📁 文件位置信息

### 核心模块文件
- **关键字识别管理模块**: js/modules/usage/keywordRecognitionManager.js
  - 文件总行数: 约 ${getFileLineCount('js/modules/usage/keywordRecognitionManager.js')} 行
  - 主要导出函数位置: 第 223 行开始
  - 规则文件路径: fankui_log/shibieguanli/recognition_rules.md

### 关键字统计模块
- **关键字统计模块**: js/modules/usage/keywordStats.js
  - 文件总行数: 约 ${getFileLineCount('js/modules/usage/keywordStats.js')} 行
  - 关键字提取函数: extractKeywords (第 50 行开始)
  - 支持多规则识别: 已实现

### 工作流管理器
- **工作流管理器**: js/modules/workflowManager.js
  - 关键字识别提示词生成函数: generateKeywordRecognitionPrompt (第 ${getFunctionLineNumber('js/modules/workflowManager.js', 'generateKeywordRecognitionPrompt')} 行开始)
  - 提示词拼接位置: executeWorkflowStep 函数中，第 1615-1622 行

### 关键字统计面板
- **关键字统计面板**: js/modules/usage/usageDisplay.js
  - 管理按钮位置: showKeywordStatsModal 函数中，第 484 行
  - 按钮事件绑定: 第 567 行开始

## 🔧 代码生成规范

### 1. 函数命名规范

所有新增的功能函数应遵循以下命名规范：

- **获取类函数**: get 开头，如 getRecognitionRuleById
- **保存类函数**: save 开头，如 saveRecognitionRule
- **更新类函数**: update 开头，如 updateRecognitionRule
- **删除类函数**: delete 开头，如 deleteRecognitionRule
- **检测类函数**: detect 开头，如 detectKeywordInText
- **处理类函数**: process 开头，如 processKeywordRecognition

### 2. 函数位置规范

新增的功能函数应放在以下位置：

**代码保存方式：**
- 保存位置：js/modules/usage/keywordRecognitionFunctions/ 目录
- 保存方式：同一规则的所有函数（包括主函数和辅助函数）保存到同一个文件中（例如 rule_${escapedRuleId}.js）
- 格式：导出函数，使用 export function 关键字，包含完整的JSDoc注释
- **重要**：由于所有函数都在同一个文件中，它们可以互相调用，不需要导入。主函数可以直接调用辅助函数（如 validateKeywords、generateTimestampInfo 等），无需使用 import 语句。

**示例：**
\\\`\\\`\\\`javascript
/**
 * 处理关键字识别（示例函数）
 * @param {string} aiContent - AI回复的完整文本内容
 * @param {string} ruleId - 规则ID
 * @param {Array<string>} keywords - 检测到的关键字数组（已去除标记符号，只包含关键字内容）
 * @param {Array<object>} matches - 匹配详情数组，每个对象包含 {keyword, fullMatch, index, ruleId, ruleTitle}
 * @returns {Promise<object>} 处理结果，必须包含 success 字段（boolean）表示是否成功
 */
export async function processKeywordRecognition(aiContent, ruleId, keywords, matches) {
    // 注意：这是process函数的正确签名，系统已经检测了关键字，keywords和matches参数已经包含了检测结果
    // 你不需要再次检测关键字，只需要处理已经检测到的关键字
    
    // 1. 参数验证
    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
        return { success: false, message: '关键字数组为空' };
    }
    
    // 2. 获取规则信息（如果需要）
    const { getAllRecognitionRules } = await import('../keywordRecognitionManager.js');
    const rules = await getAllRecognitionRules();
    const rule = rules.find(r => r.id === ruleId);
    if (!rule || !rule.enabled) {
        return { success: false, message: '规则不存在或未启用' };
    }
    
    // 3. 处理已检测到的关键字（不需要再次检测！）
    // keywords 参数已经包含了所有检测到的关键字（不包含标记符号）
    // matches 参数包含了完整的匹配信息（包含标记符号、位置等）
    
    // 4. 实现你的业务逻辑
    // 例如：记录日志、保存数据、显示提示等
    // 可以调用辅助函数来处理，例如：const validated = validateKeywords(keywords);
    
    return {
        success: true,
        message: \`成功处理 \${keywords.length} 个关键字\`,
        keywords: keywords
    };
}

/**
 * 辅助函数示例：验证关键字内容
 * @param {Array<string>} keywords - 关键字数组
 * @returns {Array<string>} 验证后的关键字数组
 */
export function validateKeywords(keywords) {
    if (!keywords || !Array.isArray(keywords)) {
        return [];
    }
    return keywords.filter(k => k && typeof k === 'string' && k.trim().length > 0);
}
\\\`\\\`\\\`

### 3. 函数调用规范

在工作流执行时，关键字识别功能函数会在以下位置被调用：

**在 js/modules/workflowManager.js 的 executeWorkflowStep 函数中：**
- 位置：第 1615 行之后（工作流控制指令提示词之后）
- 调用方式：通过 generateKeywordRecognitionPrompt 函数生成提示词，然后拼接到 userContent

**示例调用流程：**
\\\`\\\`\\\`javascript
// 在工作流执行时（executeWorkflowStep 函数中）
// 4.5. 添加关键字识别规则提示词
const keywordRecognitionPrompt = await generateKeywordRecognitionPrompt();
if (keywordRecognitionPrompt) {
    userContent += formatPromptContent(keywordRecognitionPrompt, '关键字识别规则');
}
\\\`\\\`\\\`

### 4. 数据格式规范

**规则对象格式：**
\\\`\\\`\\\`javascript
{
    id: string,              // 唯一标识符
    title: string,           // 规则标题
    startSymbol: string,      // 开头标识（如：<<）
    endSymbol: string,        // 结尾标识（如：>>）
    enabled: boolean,        // 是否启用
    functionDescription: string, // 功能描述
    createdAt: string,       // 创建时间（ISO格式）
    updatedAt: string        // 更新时间（ISO格式）
}
\\\`\\\`\\\`

### 5. 错误处理规范

所有函数都应包含适当的错误处理：

\\\`\\\`\\\`javascript
export async function yourFunction() {
    try {
        // 功能实现
    } catch (err) {
        console.error('[关键字识别管理] 操作失败:', err);
        throw err; // 或者返回错误对象
    }
}
\\\`\\\`\\\`

### 6. 缓存管理规范

如果函数涉及文件读取，应使用缓存机制：

\\\`\\\`\\\`javascript
// 使用现有的缓存机制
const content = await readRulesFile(); // 自动使用缓存
\\\`\\\`\\\`

## 📝 使用说明

1. 将本模板提供给AI，说明你需要生成的功能函数
2. AI会根据模板中的代码规范生成完整的函数代码（包含所有函数和JSDoc注释）
3. 将生成的代码粘贴到代码编辑器并点击保存，系统会将同一规则的所有函数保存到同一个文件中
4. 保存后，功能函数即可在关键字识别管理系统中使用

## ⚠️ 注意事项

1. 所有函数必须使用 export 关键字导出
2. 函数应遵循现有的代码风格和命名规范
3. 涉及文件操作时，应使用现有的 API（getFile, saveFile 等）
4. 涉及规则操作时，应使用现有的函数（getAllRecognitionRules, saveAllRecognitionRules 等）
5. 确保函数有适当的错误处理和日志记录
6. 新函数不应破坏现有的功能

## 🔗 相关文件

- 关键字识别管理模块: js/modules/usage/keywordRecognitionManager.js
- 关键字统计模块: js/modules/usage/keywordStats.js
- 工作流管理器: js/modules/workflowManager.js
- 关键字统计面板: js/modules/usage/usageDisplay.js
- 规则文件: fankui_log/shibieguanli/recognition_rules.md`;

    // 替换模板中的占位符
    let finalTemplate;
    try {
        finalTemplate = template
            .replace(/\$\{getFileLineCount\('js\/modules\/usage\/keywordRecognitionManager\.js'\)\}/g, getFileLineCount('js/modules/usage/keywordRecognitionManager.js'))
            .replace(/\$\{getFileLineCount\('js\/modules\/usage\/keywordStats\.js'\)\}/g, getFileLineCount('js/modules/usage/keywordStats.js'))
            .replace(/\$\{getFunctionLineNumber\('js\/modules\/workflowManager\.js', 'generateKeywordRecognitionPrompt'\)\}/g, getFunctionLineNumber('js/modules/workflowManager.js', 'generateKeywordRecognitionPrompt'));
    } catch (err) {
        console.error('[关键字识别管理] 替换模板占位符失败:', err);
        finalTemplate = template || '模板生成失败';
    }
    
    if (!finalTemplate || finalTemplate.trim() === '') {
        console.error('[关键字识别管理] 模板内容为空');
        content.innerHTML = '<pre style="padding: 16px; color: var(--accent-red, #f87171);">模板生成失败，请刷新页面重试。</pre>';
        return;
    }
    
    try {
        content.innerHTML = `<pre style="white-space: pre-wrap; word-wrap: break-word; font-family: 'Courier New', monospace; font-size: 12px; line-height: 1.5; color: var(--text-primary); background: var(--bg-secondary); padding: 16px; border-radius: var(--border-radius); border: 1px solid var(--border); overflow-x: auto;">${escapeHtml(finalTemplate)}</pre>`;
        panel.style.display = 'block';
    } catch (err) {
        console.error('[关键字识别管理] 设置模板内容失败:', err);
        content.innerHTML = `<pre style="padding: 16px; color: var(--accent-red, #f87171);">模板显示失败: ${err.message}</pre>`;
    }
    } catch (err) {
        console.error('[关键字识别管理] 显示功能函数模板失败:', err);
        const content = document.getElementById('keyword-recognition-function-template-content');
        if (content) {
            content.innerHTML = `<pre style="padding: 16px; color: var(--accent-red, #f87171);">模板生成失败: ${err.message}</pre>`;
        }
    }
}

/**
 * 获取文件行数（辅助函数）
 */
function getFileLineCount(filePath) {
    // 返回估算值，实际使用时可以通过代码分析获取
    if (filePath.includes('keywordRecognitionManager.js')) {
        return '1200+';
    } else if (filePath.includes('keywordStats.js')) {
        return '450+';
    } else if (filePath.includes('workflowManager.js')) {
        return '3900+';
    } else if (filePath.includes('usageDisplay.js')) {
        return '820+';
    }
    return '未知';
}

/**
 * 获取函数所在行号（辅助函数）
 */
function getFunctionLineNumber(filePath, functionName) {
    // 返回估算值，实际使用时可以通过代码分析获取
    if (filePath.includes('workflowManager.js') && functionName === 'generateKeywordRecognitionPrompt') {
        return '3877+';
    }
    return '未知';
}

/**
 * 解析代码中的函数名和导出语句
 */
function parseCodeFunctions(code) {
    const functions = [];
    const exports = [];
    
    // 匹配函数声明：export function name() 或 function name() 或 export const name = ...
    const functionPattern = /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/g;
    let match;
    while ((match = functionPattern.exec(code)) !== null) {
        const funcName = match[1] || match[2];
        if (funcName) {
            functions.push(funcName);
        }
    }
    
    // 匹配 export default { ... }
    const exportDefaultPattern = /export\s+default\s+\{([^}]+)\}/s;
    const exportDefaultMatch = code.match(exportDefaultPattern);
    if (exportDefaultMatch) {
        const exportList = exportDefaultMatch[1];
        const exportPattern = /(\w+)/g;
        let exportMatch;
        while ((exportMatch = exportPattern.exec(exportList)) !== null) {
            exports.push(exportMatch[1]);
        }
    }
    
    // 匹配单独的 export { ... }
    const exportNamedPattern = /export\s+\{([^}]+)\}/g;
    while ((match = exportNamedPattern.exec(code)) !== null) {
        const exportList = match[1];
        const exportPattern = /(\w+)/g;
        let exportMatch;
        while ((exportMatch = exportPattern.exec(exportList)) !== null) {
            exports.push(exportMatch[1]);
        }
    }
    
    return { functions, exports };
}

/**
 * 在文件中查找函数定义的位置
 */
function findFunctionInCode(code, functionName) {
    // 查找函数定义，包括 export function 和 function 声明
    const patterns = [
        new RegExp(`(export\\s+)?(async\\s+)?function\\s+${functionName}\\s*[({]`, 'g'),
        new RegExp(`(export\\s+)?const\\s+${functionName}\\s*=\\s*(async\\s+)?[\\(]`, 'g')
    ];
    
    for (const pattern of patterns) {
        const match = pattern.exec(code);
        if (match) {
            const startIndex = match.index; // 函数声明的开始位置（包括export等关键字）
            // 找到函数结束位置（匹配大括号）
            let braceCount = 0;
            let inString = false;
            let stringChar = '';
            let i = startIndex;
            
            // 先找到第一个 {
            while (i < code.length && code[i] !== '{') {
                i++;
            }
            if (i >= code.length) continue;
            
            // 从函数声明开始，而不是从第一个{开始
            const functionStart = startIndex;
            braceCount = 1;
            i++;
            
            while (i < code.length && braceCount > 0) {
                const char = code[i];
                
                if (!inString && (char === '"' || char === "'" || char === '`')) {
                    inString = true;
                    stringChar = char;
                } else if (inString && char === stringChar && code[i - 1] !== '\\') {
                    inString = false;
                } else if (!inString) {
                    if (char === '{') braceCount++;
                    else if (char === '}') braceCount--;
                }
                i++;
            }
            
            return { start: functionStart, end: i };
        }
    }
    
    return null;
}

/**
 * 从代码中提取指定函数的完整代码（包括函数前的JSDoc注释）
 * @param {string} code - 完整代码
 * @param {string} functionName - 函数名
 * @returns {string|null} 函数的完整代码（包括注释），如果找不到则返回null
 */
function extractFunctionCode(code, functionName) {
    const funcLocation = findFunctionInCode(code, functionName);
    if (!funcLocation) {
        return null;
    }
    
    // 从函数声明位置向前查找JSDoc注释
    let actualStart = funcLocation.start;
    let pos = funcLocation.start - 1;
    const maxSearchDistance = 500; // 最多向前搜索500个字符
    const startSearchPos = Math.max(0, funcLocation.start - maxSearchDistance);
    
    // 跳过空白字符
    while (pos >= startSearchPos && /\s/.test(code[pos])) {
        pos--;
    }
    
    // 如果前面是 */，说明有注释块，继续向前查找注释开始
    if (pos >= 1 && code[pos] === '/' && code[pos - 1] === '*') {
        pos -= 2;
        // 查找注释块的开始标记 /** 或 /*
        while (pos >= 1 && pos >= startSearchPos) {
            if (code[pos] === '*' && code[pos - 1] === '/') {
                // 找到 /** 或 /*
                actualStart = pos - 1;
                // 继续向前，跳过可能的空行和空白
                pos -= 2;
                while (pos >= startSearchPos && (code[pos] === ' ' || code[pos] === '\t')) {
                    pos--;
                }
                if (pos >= 0 && code[pos] === '\n') {
                    // 如果有换行，从换行后开始
                    actualStart = pos + 1;
                }
                break;
            }
            pos--;
        }
    }
    
    return code.substring(actualStart, funcLocation.end).trim();
}

/**
 * 清理指定规则的所有函数文件
 * @param {string} ruleId - 规则ID
 */
async function cleanupRuleFunctionFiles(ruleId) {
    try {
        const indexFilePath = `${FUNCTIONS_DIR}/.index.json`;
        let indexData = {};
        
        // 读取索引文件
        try {
            const indexContent = await getFile(indexFilePath);
            if (indexContent && (!indexContent.trim().startsWith('{') || !indexContent.includes('"error"'))) {
                indexData = JSON.parse(indexContent);
            }
        } catch (err) {
            console.warn('[关键字识别管理] 读取索引文件失败:', err);
            return;
        }
        
        // 获取该规则的所有函数
        const ruleFunctions = indexData[ruleId] || [];
        
        // 遍历每个函数文件
        for (const funcNameOrFile of ruleFunctions) {
            const funcName = funcNameOrFile.endsWith('.js') ? funcNameOrFile.replace('.js', '') : funcNameOrFile;
            const filePath = `${FUNCTIONS_DIR}/${funcName}.js`;
            
            try {
                const existingContent = await getFile(filePath);
                
                // 检查文件中是否还有其他规则在使用
                const ruleIdMatches = existingContent.match(/\/\/\s*规则ID:\s*([^\n]+)/);
                if (ruleIdMatches && ruleIdMatches[1]) {
                    const ruleIds = ruleIdMatches[1].split(',').map(id => id.trim()).filter(id => id && id !== ruleId);
                    
                    if (ruleIds.length > 0) {
                        // 还有其他规则在使用，只移除当前规则ID
                        const updatedContent = existingContent.replace(
                            /\/\/\s*规则ID:\s*[^\n]+/,
                            `// 规则ID: ${ruleIds.join(', ')}`
                        );
                        await saveFile(filePath, updatedContent);
                        console.log(`[关键字识别管理] 已从函数文件 ${funcName}.js 中移除规则 ${ruleId}，其他规则仍在使用`);
                    } else {
                        // 没有其他规则使用，删除文件
                        await saveFile(filePath, '');
                        console.log(`[关键字识别管理] 已删除不再使用的函数文件: ${funcName}.js`);
                    }
                } else {
                    // 文件格式异常，直接删除
                    await saveFile(filePath, '');
                    console.log(`[关键字识别管理] 已删除格式异常的函数文件: ${funcName}.js`);
                }
            } catch (err) {
                // 文件不存在，忽略
                console.log(`[关键字识别管理] 函数文件不存在，跳过: ${funcName}.js`);
            }
        }
        
        // 从索引中移除该规则
        delete indexData[ruleId];
        delete indexData[ruleId + '_timestamp'];
        delete indexData[ruleId + '_lastModified'];
        
        // 保存更新后的索引
        await saveFile(indexFilePath, JSON.stringify(indexData, null, 2));
        console.log(`[关键字识别管理] 已清理规则 ${ruleId} 的所有函数文件`);
        
    } catch (err) {
        console.error('[关键字识别管理] 清理规则函数文件失败:', err);
        throw err;
    }
}

/**
 * 从文件中移除指定的代码块
 */
function removeCodeBlock(code, startIndex, endIndex) {
    // 移除代码块，同时移除前后的空行
    const before = code.substring(0, startIndex);
    const after = code.substring(endIndex);
    
    // 移除前面多余的空行
    const beforeTrimmed = before.replace(/\n+$/, '');
    // 移除后面多余的空行
    const afterTrimmed = after.replace(/^\n+/, '');
    
    // 确保只有一个空行分隔
    let result = beforeTrimmed;
    if (beforeTrimmed && !beforeTrimmed.endsWith('\n')) {
        result += '\n';
    } else if (!beforeTrimmed.endsWith('\n\n')) {
        result = beforeTrimmed.endsWith('\n') ? beforeTrimmed : beforeTrimmed + '\n';
    }
    
    if (afterTrimmed && !afterTrimmed.startsWith('\n')) {
        result += '\n' + afterTrimmed;
    } else {
        result += afterTrimmed;
    }
    
    return result;
}

/**
 * 获取用户保存的代码块（位于文件末尾的标记之间）
 * @param {string} code - 文件内容
 * @param {string} ruleId - 可选，如果提供则只提取该规则的代码块
 * @returns {Array} 代码块数组，每个元素包含 {code, start, end, ruleId}
 */
function extractUserCodeBlocks(code, ruleId = null) {
    // 匹配带规则ID的标记：
// === 用户代码开始 ruleId:xxx ===
    const markerPattern = /\/\/\s*===\s*用户代码(开始|结束)(?:\s+ruleId:([^\s=]+))?\s*===/g;
    const blocks = [];
    const markers = [];
    
    // 收集所有标记
    let match;
    while ((match = markerPattern.exec(code)) !== null) {
        const isStart = match[1] === '开始';
        const blockRuleId = match[2] || null;
        markers.push({
            index: match.index,
            isStart: isStart,
            ruleId: blockRuleId,
            fullMatch: match[0]
        });
    }
    
    // 按位置排序
    markers.sort((a, b) => a.index - b.index);
    
    // 配对开始和结束标记
    for (let i = 0; i < markers.length; i++) {
        if (!markers[i].isStart) continue;
        
        const startMarker = markers[i];
        let endMarker = null;
        
        // 查找对应的结束标记（同一规则ID或都没有规则ID）
        for (let j = i + 1; j < markers.length; j++) {
            if (!markers[j].isStart && 
                markers[j].ruleId === startMarker.ruleId) {
                endMarker = markers[j];
                break;
            }
        }
        
        // 如果提供了ruleId，只提取匹配的代码块
        if (ruleId !== null && startMarker.ruleId !== ruleId) {
            continue;
        }
        
        if (endMarker) {
            const codeStart = startMarker.index + startMarker.fullMatch.length;
            const blockCode = code.substring(codeStart, endMarker.index).trim();
            blocks.push({
                code: blockCode,
                start: startMarker.index,
                end: endMarker.index + endMarker.fullMatch.length,
                ruleId: startMarker.ruleId
            });
        } else {
            // 没有结束标记，说明代码在文件末尾
            const codeStart = startMarker.index + startMarker.fullMatch.length;
            const blockCode = code.substring(codeStart).trim();
            blocks.push({
                code: blockCode,
                start: startMarker.index,
                end: code.length,
                ruleId: startMarker.ruleId
            });
            break;
        }
    }
    
    return blocks;
}

/**
 * 从用户代码块中提取所有导出的函数名
 * @param {string} code - 用户代码块内容
 * @returns {Array<string>} 导出的函数名数组
 */
function extractExportedFunctions(code) {
    const functions = [];
    
    // 匹配 export function 和 export async function
    const exportFunctionPattern = /export\s+(?:async\s+)?function\s+(\w+)/g;
    let match;
    while ((match = exportFunctionPattern.exec(code)) !== null) {
        functions.push(match[1]);
    }
    
    // 匹配 export const functionName = ...
    const exportConstPattern = /export\s+const\s+(\w+)\s*=\s*(?:async\s+)?\(/g;
    while ((match = exportConstPattern.exec(code)) !== null) {
        functions.push(match[1]);
    }
    
    // 匹配 export { functionName }
    const exportNamedPattern = /export\s*\{\s*(\w+)/g;
    while ((match = exportNamedPattern.exec(code)) !== null) {
        functions.push(match[1]);
    }
    
    return [...new Set(functions)]; // 去重
}

/**
 * 智能查找处理函数：先找标准函数，找不到则扫描用户代码块
 * @param {object} keywordManager - 导入的模块对象
 * @param {string} ruleId - 规则ID
 * @param {string} standardFunctionName - 标准函数名（如 process2Recognition）
 * @returns {Promise<object|null>} {functionName: string, function: Function, source: string} 或 null
 */
export async function findProcessFunction(keywordManager, ruleId, standardFunctionName) {
    // 第一步：尝试查找标准函数
    if (typeof keywordManager[standardFunctionName] === 'function') {
        console.log(`[关键字识别] 找到标准函数: ${standardFunctionName}`);
        return {
            functionName: standardFunctionName,
            function: keywordManager[standardFunctionName],
            source: 'standard'
        };
    }
    
    // 第二步：如果标准函数不存在，尝试从函数文件中动态导入
    console.log(`[关键字识别] 标准函数 ${standardFunctionName} 不存在，尝试从函数文件加载...`);
    
    try {
        // 首先尝试从函数文件加载
        const indexFilePath = `${FUNCTIONS_DIR}/.index.json`;
        let functionFiles = [];
        
        try {
            const { getFile } = await import('../../core/api.js');
            const indexContent = await getFile(indexFilePath);
            if (indexContent && (!indexContent.trim().startsWith('{') || !indexContent.includes('"error"'))) {
                const indexData = JSON.parse(indexContent);
                if (indexData[ruleId] && Array.isArray(indexData[ruleId])) {
                    functionFiles = indexData[ruleId];
                }
            }
        } catch (err) {
            console.warn('[关键字识别] 读取函数索引文件失败，尝试从主文件读取:', err);
        }
        
        // 如果从函数文件找到了，尝试动态导入
        if (functionFiles.length > 0) {
            const allFunctions = new Map();
            
            for (const funcNameOrFile of functionFiles) {
                const fileName = funcNameOrFile.endsWith('.js') ? funcNameOrFile : `${funcNameOrFile}.js`;
                const filePath = `./keywordRecognitionFunctions/${fileName}`;
                
                try {
                    // 动态导入函数文件
                    const funcModule = await import(filePath);
                    
                    // 遍历模块的所有导出
                    for (const [exportName, exportValue] of Object.entries(funcModule)) {
                        if (typeof exportValue === 'function') {
                            if (!allFunctions.has(exportName)) {
                                allFunctions.set(exportName, {
                                    functionName: exportName,
                                    function: exportValue,
                                    source: 'function-file',
                                    ruleId: ruleId,
                                    filePath: filePath
                                });
                            }
                        }
                    }
                } catch (importErr) {
                    console.warn(`[关键字识别] 动态导入函数文件失败: ${filePath}`, importErr);
                }
            }
            
            if (allFunctions.size > 0) {
                const functionList = Array.from(allFunctions.values());
                
                // 优先选择标准函数名
                const standardFunc = functionList.find(f => f.functionName === standardFunctionName);
                if (standardFunc) {
                    console.log(`[关键字识别] 从函数文件找到标准函数: ${standardFunc.functionName}`);
                    return standardFunc;
                }
                
                // 优先选择名称包含 process 和 Recognition 的函数
                const processFunctions = functionList.filter(f => 
                    f.functionName.toLowerCase().includes('process') && 
                    f.functionName.toLowerCase().includes('recognition')
                );
                
                if (processFunctions.length > 0) {
                    const selected = processFunctions[0];
                    console.log(`[关键字识别] 从函数文件找到处理函数: ${selected.functionName}`);
                    return selected;
                }
                
                // 返回第一个可用的函数
                const selected = functionList[0];
                console.log(`[关键字识别] 从函数文件找到函数: ${selected.functionName}`);
                return selected;
            }
        }
        
        // 如果函数文件方式失败，尝试从主文件读取（向后兼容）
        const { getFile } = await import('../../core/api.js');
        const fileContent = await getFile('js/modules/usage/keywordRecognitionManager.js');
        
        if (!fileContent) {
            console.warn('[关键字识别] 无法读取文件内容');
            return null;
        }
        
        // 提取该规则的用户代码块
        const codeBlocks = extractUserCodeBlocks(fileContent, ruleId);
        
        if (codeBlocks.length === 0) {
            console.log(`[关键字识别] 规则 ${ruleId} 没有用户代码块`);
            return null;
        }
        
        // 从所有代码块中提取函数名
        const allFunctions = new Map();
        for (const block of codeBlocks) {
            const functions = extractExportedFunctions(block.code);
            for (const funcName of functions) {
                // 检查函数是否在模块中可用
                if (typeof keywordManager[funcName] === 'function') {
                    if (!allFunctions.has(funcName)) {
                        allFunctions.set(funcName, {
                            functionName: funcName,
                            function: keywordManager[funcName],
                            source: 'user-code',
                            ruleId: block.ruleId
                        });
                    }
                }
            }
        }
        
        if (allFunctions.size === 0) {
            console.log(`[关键字识别] 在用户代码块中未找到可用的导出函数`);
            return null;
        }
        
        // 如果有多个函数，优先选择名称最接近标准函数名的
        const functionList = Array.from(allFunctions.values());
        
        // 优先选择名称包含 process 和 Recognition 的函数
        const processFunctions = functionList.filter(f => 
            f.functionName.toLowerCase().includes('process') && 
            f.functionName.toLowerCase().includes('recognition')
        );
        
        if (processFunctions.length > 0) {
            const selected = processFunctions[0];
            console.log(`[关键字识别] 从用户代码块中找到处理函数: ${selected.functionName}`);
            return selected;
        }
        
        // 如果没有找到 process 函数，返回第一个可用的函数
        const selected = functionList[0];
        console.log(`[关键字识别] 从用户代码块中找到函数: ${selected.functionName} (注意：建议使用包含 process 和 Recognition 的函数名)`);
        return selected;
        
    } catch (err) {
        console.error('[关键字识别] 扫描用户代码块失败:', err);
        return null;
    }
}

/**
 * 保存功能函数代码到文件
 */
export async function saveKeywordRecognitionFunctionCode() {
    const codeInput = document.getElementById('keyword-recognition-function-code-input');
    const statusDiv = document.getElementById('keyword-recognition-function-save-status');
    
    if (!codeInput || !statusDiv) {
        alert('代码输入框不存在');
        return;
    }
    
    const code = codeInput.value.trim();
    if (!code) {
        statusDiv.textContent = '⚠️ 请输入代码';
        statusDiv.style.color = 'var(--accent-red, #f87171)';
        setTimeout(() => {
            statusDiv.textContent = '';
        }, 3000);
        return;
    }
    
    try {
        // 目标文件路径
        const targetFilePath = 'js/modules/usage/keywordRecognitionManager.js';
        
        // 读取现有文件内容
        let existingContent = '';
        try {
            existingContent = await getFile(targetFilePath);
            // 检查是否是错误响应
            if (existingContent.trim().startsWith('{') && existingContent.includes('"error"')) {
                existingContent = '';
            }
        } catch (err) {
            console.warn('[关键字识别管理] 读取文件失败，将创建新文件:', err);
            existingContent = '';
        }
        
        // 获取当前编辑的规则ID
        if (!currentEditingRule || !currentEditingRule.id) {
            statusDiv.textContent = '❌ 请先选择要编辑的规则';
            statusDiv.style.color = 'var(--accent-red, #f87171)';
            setTimeout(() => {
                statusDiv.textContent = '';
            }, 3000);
            return;
        }
        
        const ruleId = currentEditingRule.id;
        
        // 提取当前规则已保存的代码
        const currentRuleBlocks = extractUserCodeBlocks(existingContent, ruleId);
        const savedCode = currentRuleBlocks.length > 0 ? currentRuleBlocks[0].code.trim() : '';
        
        // 比较当前代码和已保存的代码
        // 只有当已保存的代码存在（不是第一次保存）且内容完全相同时，才提示用户已保存
        // 第一次保存时（savedCode为空），即使代码相同也正常保存，不显示"已保存"提示
        if (savedCode && savedCode.length > 0 && code.length === savedCode.length && code === savedCode) {
            // 内容完全相同，提示用户已保存（仅第二次及以后保存时）
            alert('代码内容未发生变化，已保存到文件。\n\n请刷新页面使新代码生效。');
            statusDiv.textContent = 'ℹ️ 代码内容未变化，已保存。请刷新页面使代码生效。';
            statusDiv.style.color = 'var(--accent-blue, #3b82f6)';
            setTimeout(() => {
                statusDiv.textContent = '';
            }, 5000);
            return;
        }
        
        statusDiv.textContent = '⏳ 正在保存...';
        statusDiv.style.color = 'var(--text-muted)';
        
        // 解析新代码中的函数
        const newCodeFunctions = parseCodeFunctions(code);
        
        // 确保函数目录存在
        try {
            await createFolder(FUNCTIONS_DIR);
        } catch (err) {
            console.warn('[关键字识别管理] 创建函数目录失败:', err);
        }
        
        // 读取索引文件，获取当前规则的所有旧函数
        const indexFilePath = `${FUNCTIONS_DIR}/.index.json`;
        let indexData = {};
        try {
            const indexContent = await getFile(indexFilePath);
            if (indexContent && (!indexContent.trim().startsWith('{') || !indexContent.includes('"error"'))) {
                indexData = JSON.parse(indexContent);
            }
        } catch (err) {
            // 索引文件不存在，创建新的
        }
        
        // 获取当前规则的旧函数列表（从索引文件）
        const oldFunctionList = indexData[ruleId] || [];
        const oldFunctionsSet = new Set(oldFunctionList);
        
        // 为每个函数创建单独的文件
        const savedFunctions = [];
        const functionFiles = new Map(); // 函数名 -> 文件路径的映射
        const newFunctionsSet = new Set(); // 新函数集合
        
        // 先处理新代码中的函数
        
        // 将同一规则的所有函数保存到同一个文件中（保持函数之间的依赖关系）
        const ruleFileName = `rule_${ruleId}.js`;
        const filePath = `${FUNCTIONS_DIR}/${ruleFileName}`;
        
        // 构建文件内容，包含所有函数代码
        const fileContent = `// 规则ID: ${ruleId}\n// 自动生成，请勿手动修改\n// 最后更新: ${new Date().toISOString()}\n// 包含函数: ${newCodeFunctions.functions.length > 0 ? newCodeFunctions.functions.join(', ') : '无'}\n\n${code}`;
        await saveFile(filePath, fileContent);
        
        // 将所有函数名添加到集合中（用于索引）
        newCodeFunctions.functions.forEach(funcName => {
            newFunctionsSet.add(funcName);
            savedFunctions.push(funcName);
            functionFiles.set(funcName, filePath);
        });
        
        console.log(`[关键字识别管理] 已保存规则代码到文件: ${ruleFileName} (包含 ${newCodeFunctions.functions.length} 个函数)`);
        
        // 清理不再使用的函数文件
        // 找出需要删除的函数：在旧函数列表中但不在新函数列表中
        const functionsToRemove = oldFunctionList.filter(funcNameOrFile => {
            const funcName = funcNameOrFile.endsWith('.js') ? funcNameOrFile.replace('.js', '') : funcNameOrFile;
            return !newFunctionsSet.has(funcName) && !funcName.startsWith('rule_');
        });
        
        for (const funcNameOrFile of functionsToRemove) {
            const funcName = funcNameOrFile.endsWith('.js') ? funcNameOrFile.replace('.js', '') : funcNameOrFile;
            const filePath = `${FUNCTIONS_DIR}/${funcName}.js`;
            
            try {
                const existingContent = await getFile(filePath);
                // 检查文件中是否还有其他规则在使用
                const ruleIdMatches = existingContent.match(/\/\/\s*规则ID:\s*([^\n]+)/);
                if (ruleIdMatches && ruleIdMatches[1]) {
                    const ruleIds = ruleIdMatches[1].split(',').map(id => id.trim()).filter(id => id && id !== ruleId);
                    
                    if (ruleIds.length > 0) {
                        // 还有其他规则在使用，只移除当前规则ID
                        const updatedContent = existingContent.replace(
                            /\/\/\s*规则ID:\s*[^\n]+/,
                            `// 规则ID: ${ruleIds.join(', ')}`
                        );
                        await saveFile(filePath, updatedContent);
                        console.log(`[关键字识别管理] 已从函数文件 ${funcName}.js 中移除规则 ${ruleId}，其他规则仍在使用`);
                    } else {
                        // 没有其他规则使用，删除文件（通过写入空内容）
                        await saveFile(filePath, '');
                        console.log(`[关键字识别管理] 已删除不再使用的函数文件: ${funcName}.js`);
                    }
                } else {
                    // 文件格式异常，直接删除
                    await saveFile(filePath, '');
                    console.log(`[关键字识别管理] 已删除格式异常的函数文件: ${funcName}.js`);
                }
            } catch (err) {
                // 文件不存在，忽略
                console.log(`[关键字识别管理] 函数文件不存在，跳过删除: ${funcName}.js`);
            }
        }
        
        // 更新索引文件：现在使用规则文件名（包含所有函数）
        indexData[ruleId] = [ruleFileName];
        indexData[ruleId + '_timestamp'] = Date.now();
        indexData[ruleId + '_lastModified'] = new Date().toISOString();
        
        await saveFile(indexFilePath, JSON.stringify(indexData, null, 2));
        
        // 保存后不清空输入框，保留代码显示
        // codeInput.value = ''; // 注释掉，保留代码在输入框
        
        // 显示成功消息
        statusDiv.textContent = '✅ 代码已成功保存！请刷新页面使新代码生效。';
        statusDiv.style.color = 'var(--accent-green, #4ade80)';
        
        // 5秒后清除消息，但保留代码
        setTimeout(() => {
            statusDiv.textContent = '';
        }, 5000);
        
        // 存储当前保存的代码，用于后续清空操作
        if (codeInput) {
            codeInput.dataset.lastSavedCode = code;
        }
        
    } catch (err) {
        console.error('[关键字识别管理] 保存代码失败:', err);
        statusDiv.textContent = '❌ 保存失败: ' + (err.message || err);
        statusDiv.style.color = 'var(--accent-red, #f87171)';
        setTimeout(() => {
            statusDiv.textContent = '';
        }, 5000);
    }
}


/**
 * 清空功能函数代码输入框，并从文件中删除已保存的代码
 */
export async function clearKeywordRecognitionFunctionCode() {
    const codeInput = document.getElementById('keyword-recognition-function-code-input');
    const statusDiv = document.getElementById('keyword-recognition-function-save-status');
    
    if (!codeInput) return;
    
    // 询问用户是否要从文件中删除已保存的代码
    const removeFromFile = confirm('是否同时从文件中删除已保存的代码？\n\n点击"确定"：删除文件中的代码\n点击"取消"：仅清空输入框');
    
    if (removeFromFile) {
        try {
            statusDiv.textContent = '⏳ 正在从文件中删除代码...';
            statusDiv.style.color = 'var(--text-muted)';
            
            // 获取当前编辑的规则ID
            if (!currentEditingRule || !currentEditingRule.id) {
                // 如果没有当前规则，仅清空输入框
                codeInput.value = '';
                if (codeInput.dataset) {
                    delete codeInput.dataset.lastSavedCode;
                }
                return;
            }
            
            const ruleId = currentEditingRule.id;
            
            // 清理函数文件（新机制）- 这是主要方式，不需要读取大文件
            // 由于我们已经迁移到函数文件系统，主文件中的旧代码块不再使用
            // 系统会优先从函数文件加载，所以不需要清理主文件，避免413错误
            try {
                await cleanupRuleFunctionFiles(ruleId);
                console.log(`[关键字识别管理] 已清理规则 ${ruleId} 的函数文件`);
            } catch (err) {
                console.error('[关键字识别管理] 清理函数文件失败:', err);
                // 即使清理失败，也继续执行，因为主文件中的旧代码不会影响功能
                // 系统会优先从函数文件加载，如果函数文件不存在，才会尝试从主文件加载
            }
            
            // 注意：我们不再清理主文件中的旧代码块，原因如下：
            // 1. 主文件可能很大，读取和保存会导致413错误
            // 2. 系统已经优先从函数文件加载，主文件中的旧代码不会影响功能
            // 3. 如果用户需要完全清理，可以手动编辑主文件，或者等待系统自动迁移完成
            console.log(`[关键字识别管理] 已跳过主文件清理（避免413错误），系统会优先使用函数文件`);
            
            // 清空输入框
            codeInput.value = '';
            if (codeInput.dataset) {
                delete codeInput.dataset.lastSavedCode;
            }
            
            statusDiv.textContent = '✅ 已从文件中删除代码！';
            statusDiv.style.color = 'var(--accent-green, #4ade80)';
            
            setTimeout(() => {
                statusDiv.textContent = '';
            }, 3000);
            
        } catch (err) {
            console.error('[关键字识别管理] 删除代码失败:', err);
            statusDiv.textContent = '❌ 删除失败: ' + (err.message || err);
            statusDiv.style.color = 'var(--accent-red, #f87171)';
            setTimeout(() => {
                statusDiv.textContent = '';
            }, 5000);
        }
    } else {
        // 仅清空输入框
        codeInput.value = '';
        if (codeInput.dataset) {
            delete codeInput.dataset.lastSavedCode;
        }
        if (statusDiv) {
            statusDiv.textContent = '';
        }
    }
}

/**
 * 加载已保存的代码到输入框
 */
export async function loadSavedCodeToInput() {
    const codeInput = document.getElementById('keyword-recognition-function-code-input');
    if (!codeInput) return;
    
    // 如果没有当前编辑的规则，清空输入框
    if (!currentEditingRule || !currentEditingRule.id) {
        codeInput.value = '';
        return;
    }
    
    const ruleId = currentEditingRule.id;
    
    try {
        // 首先尝试从函数文件中读取
        const indexFilePath = `${FUNCTIONS_DIR}/.index.json`;
        let functionCode = '';
        
        try {
            const indexContent = await getFile(indexFilePath);
            if (indexContent && (!indexContent.trim().startsWith('{') || !indexContent.includes('"error"'))) {
                const indexData = JSON.parse(indexContent);
                if (indexData[ruleId] && Array.isArray(indexData[ruleId])) {
                    // 从函数文件中读取所有函数代码
                    const functionCodes = [];
                    for (const funcNameOrFile of indexData[ruleId]) {
                        const filePath = funcNameOrFile.endsWith('.js') 
                            ? `${FUNCTIONS_DIR}/${funcNameOrFile}`
                            : `${FUNCTIONS_DIR}/${funcNameOrFile}.js`;
                        try {
                            const funcFileContent = await getFile(filePath);
                            // 移除注释行（规则ID、函数名、自动生成提示）
                            const cleanedFuncCode = funcFileContent
                                .split('\n')
                                .filter(line => !line.trim().startsWith('//'))
                                .join('\n')
                                .trim();
                            functionCodes.push(cleanedFuncCode);
                        } catch (err) {
                            console.warn(`[关键字识别管理] 读取函数文件失败: ${filePath}`, err);
                        }
                    }
                    functionCode = functionCodes.join('\n\n');
                }
            }
        } catch (err) {
            console.warn('[关键字识别管理] 读取索引文件失败，尝试从主文件读取:', err);
        }
        
        // 如果从函数文件读取失败，尝试从主文件读取（向后兼容）
        if (!functionCode) {
            const targetFilePath = 'js/modules/usage/keywordRecognitionManager.js';
            let existingContent = '';
            
            try {
                existingContent = await getFile(targetFilePath);
                if (existingContent.trim().startsWith('{') && existingContent.includes('"error"')) {
                    codeInput.value = '';
                    return;
                }
            } catch (err) {
                codeInput.value = '';
                return;
            }
            
            // 提取当前规则的代码块
            const ruleBlocks = extractUserCodeBlocks(existingContent, ruleId);
            if (ruleBlocks.length > 0) {
                functionCode = ruleBlocks[0].code.trim();
            }
        }
        
        if (functionCode) {
            // 获取当前规则的代码（应该只有一个代码块）
            const ruleCode = functionCode;
            
            // 过滤掉内部实现代码
            const cleanedCode = ruleCode
                .split('\n')
                .filter(line => {
                    // 过滤掉包含内部实现细节的行
                    const trimmedLine = line.trim();
                    // 过滤掉所有包含标记字符串定义的行
                    if (trimmedLine.includes('const markerStart') ||
                        trimmedLine.includes('const markerEnd') ||
                        trimmedLine.includes('const userCodeMarker') ||
                        trimmedLine.includes('const userCodeEndMarker') ||
                        trimmedLine.match(/\/\/\s*===\s*用户代码/)) {
                        return false;
                    }
                    return true;
                })
                .join('\n')
                .trim();
            
            // 只有当清理后的代码不为空且看起来像有效代码时才设置
            if (cleanedCode && cleanedCode.length > 10) {
                codeInput.value = cleanedCode;
            } else {
                codeInput.value = '';
            }
        } else {
            // 如果没有当前规则的代码块，清空输入框
            codeInput.value = '';
        }
    } catch (err) {
        console.error('[关键字识别管理] 加载代码失败:', err);
        codeInput.value = '';
    }
}

/**
 * 检测AI消息中是否包含关键字识别指令
 * @param {string} message - AI消息内容
 * @returns {Promise<object|null>} {detected: boolean, keywords: Array<string>, matches: Array<object>, results: Array<object>}
 */
export async function detectKeywordRecognition(message, ruleId = null) {
    if (!message) return null;

    const targetRules = await getAllRecognitionRules();

    if (!targetRules || targetRules.length === 0) {
        console.log('[关键字识别管理] 未配置任何识别规则');
        return null;
    }

    // 过滤出启用的规则
    let enabledRules = targetRules.filter(rule => rule.enabled);
    
    // 如果指定了规则ID，只使用该规则
    if (ruleId) {
        enabledRules = enabledRules.filter(rule => rule.id === ruleId);
    }
    
    if (enabledRules.length === 0) {
        console.log('[关键字识别管理] 没有启用的识别规则' + (ruleId ? `或规则 ${ruleId} 不存在` : ''));
        return null;
    }

    // 确保转义正则表达式特殊字符
    function escapeRegex(str) {
        if (!str) return '';
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    const results = [];

    // 检测每个启用的规则
    for (const rule of enabledRules) {
        const startEscaped = escapeRegex(rule.startSymbol);
        const endEscaped = escapeRegex(rule.endSymbol);
        
        // 构建正则表达式：对于多字符endSymbol，使用负向前瞻确保正确匹配
        let patternStr;
        if (rule.endSymbol.length === 1) {
            // 单字符endSymbol：使用字符类更高效
            patternStr = `${startEscaped}([^${endEscaped}]+?)${endEscaped}`;
        } else {
            // 多字符endSymbol：使用负向前瞻，匹配任意字符直到遇到完整的endSymbol
            patternStr = `${startEscaped}((?:(?!${endEscaped}).)+?)${endEscaped}`;
        }
        
        let pattern;
        try {
            pattern = new RegExp(patternStr, 'g');
        } catch (err) {
            console.error(`[关键字识别管理] 构建正则表达式失败 (规则: ${rule.startSymbol}...${rule.endSymbol}):`, err);
            continue; // 跳过这个规则
        }

        const matches = [];
        let match;
        // 重置正则表达式的lastIndex，确保每次规则都从头开始匹配
        pattern.lastIndex = 0;
        while ((match = pattern.exec(message)) !== null) {
            const keyword = match[1].trim();
            if (keyword) {
                matches.push({
                    keyword: keyword,
                    fullMatch: match[0],
                    index: match.index,
                    ruleId: rule.id,
                    ruleTitle: rule.title
                });
            }
        }

        if (matches.length > 0) {
            results.push({
                ruleId: rule.id,
                ruleTitle: rule.title,
                startSymbol: rule.startSymbol,
                endSymbol: rule.endSymbol,
                keywords: matches.map(m => m.keyword),
                matches: matches
            });
        }
    }

    if (results.length === 0) return null;

    // 合并所有结果
    const allKeywords = [];
    const allMatches = [];
    results.forEach(result => {
        allKeywords.push(...result.keywords);
        allMatches.push(...result.matches);
    });

    console.log('[关键字识别管理] 检测到关键字:', allKeywords.length, '个，规则数量:', results.length);
    allMatches.forEach(m => console.log(`  - 匹配: "${m.fullMatch}" (关键字: "${m.keyword}", 规则: "${m.ruleTitle}")`));

    return {
        detected: true,
        keywords: [...new Set(allKeywords)], // 去重
        matches: allMatches,
        results: results
    };
}

/**
 * 显示关键字识别测试面板
 */
export async function showKeywordRecognitionTestPanel() {
    const panel = document.getElementById('keyword-recognition-test-panel');
    if (!panel) {
        console.error('[关键字识别测试] 测试面板不存在');
        return;
    }
    
    // 显示面板
    panel.style.display = 'flex';
    panel.focus();
    
    // 加载规则列表
    const rules = await getAllRecognitionRules();
    const ruleSelect = document.getElementById('test-rule-select');
    if (ruleSelect) {
        ruleSelect.innerHTML = '<option value="">请选择规则...</option>';
        rules.forEach(rule => {
            const option = document.createElement('option');
            option.value = rule.id;
            option.textContent = `${rule.title} (${rule.startSymbol}...${rule.endSymbol})`;
            ruleSelect.appendChild(option);
        });
    }
    
    // 加载工作流列表（从state.workflows获取，与工作流管理面板联动）
    const { loadWorkflows } = await import('../workflowManager.js');
    await loadWorkflows();
    const workflowSelect = document.getElementById('test-workflow-select');
    if (workflowSelect) {
        workflowSelect.innerHTML = '<option value="">请选择工作流...</option>';
        // 从state获取工作流列表，确保与工作流管理面板同步
        const state = await import('../../core/state.js');
        const workflows = state.state.workflows || [];
        workflows.forEach(workflow => {
            const option = document.createElement('option');
            option.value = workflow.name;
            option.textContent = workflow.name;
            workflowSelect.appendChild(option);
        });
    }
    
    // 重置步骤选择
    const stepSelect = document.getElementById('test-step-select');
    if (stepSelect) {
        stepSelect.innerHTML = '<option value="">请先选择工作流...</option>';
        stepSelect.disabled = true;
    }
    
    // 重置测试内容
    const testContentInput = document.getElementById('test-content-input');
    if (testContentInput) {
        testContentInput.value = '';
    }
    
    // 隐藏结果
    const resultsContainer = document.getElementById('test-results-container');
    if (resultsContainer) {
        resultsContainer.style.display = 'none';
    }
}

/**
 * 初始化关键字识别测试面板
 */
export async function initKeywordRecognitionTestPanel() {
    // 打开工作流管理面板按钮
    const openWorkflowManagerBtn = document.getElementById('open-workflow-manager-btn');
    if (openWorkflowManagerBtn) {
        openWorkflowManagerBtn.addEventListener('click', async () => {
            const { loadWorkflows } = await import('../workflowManager.js');
            const workflowPanel = document.getElementById('workflow-panel');
            if (workflowPanel) {
                workflowPanel.style.display = 'flex';
                workflowPanel.focus();
                await loadWorkflows();
                
                // 监听工作流选择事件，同步到测试面板
                const originalSelectWorkflow = window.selectWorkflow;
                if (originalSelectWorkflow) {
                    window.selectWorkflow = async function(workflowName) {
                        await originalSelectWorkflow(workflowName);
                        // 同步到测试面板
                        const testWorkflowSelect = document.getElementById('test-workflow-select');
                        if (testWorkflowSelect) {
                            testWorkflowSelect.value = workflowName;
                            testWorkflowSelect.dispatchEvent(new Event('change'));
                        }
                    };
                }
            }
        });
    }
    
    // 工作流选择变化时，加载步骤列表
    const workflowSelect = document.getElementById('test-workflow-select');
    if (workflowSelect) {
        workflowSelect.addEventListener('change', async (e) => {
            const workflowName = e.target.value;
            const stepSelect = document.getElementById('test-step-select');
            
            if (!workflowName) {
                if (stepSelect) {
                    stepSelect.innerHTML = '<option value="">请先选择工作流...</option>';
                    stepSelect.disabled = true;
                }
                return;
            }
            
            try {
                const { getWorkflow } = await import('../../core/api.js');
                const { parseWorkflowFormat } = await import('../workflowManager.js');
                const workflow = await getWorkflow(workflowName);
                const steps = parseWorkflowFormat(workflow.content);
                
                if (stepSelect) {
                    stepSelect.innerHTML = '<option value="">执行全部步骤</option>';
                    steps.forEach((step, index) => {
                        const stepId = step.viewId || step.self || `步骤${index + 1}`;
                        const prevIds = (step.viewPrev || step.prev || []).join(', ') || '无';
                        const nextIds = (step.viewNext || step.next || []).join(', ') || '无';
                        const option = document.createElement('option');
                        option.value = index.toString();
                        option.textContent = `${index + 1}. ${stepId} (前置: ${prevIds}, 下一: ${nextIds})`;
                        stepSelect.appendChild(option);
                    });
                    stepSelect.disabled = false;
                }
            } catch (err) {
                console.error('[关键字识别测试] 加载工作流步骤失败:', err);
                if (stepSelect) {
                    stepSelect.innerHTML = '<option value="">加载失败</option>';
                    stepSelect.disabled = true;
                }
            }
        });
    }
    
    // 执行测试按钮
    const runTestBtn = document.getElementById('run-keyword-test-btn');
    if (runTestBtn) {
        runTestBtn.addEventListener('click', async () => {
            await runKeywordRecognitionTest();
        });
    }
    
    // 清空结果按钮
    const clearResultsBtn = document.getElementById('clear-test-results-btn');
    if (clearResultsBtn) {
        clearResultsBtn.addEventListener('click', () => {
            const resultsContainer = document.getElementById('test-results-container');
            const resultsContent = document.getElementById('test-results-content');
            if (resultsContainer) {
                resultsContainer.style.display = 'none';
            }
            if (resultsContent) {
                resultsContent.textContent = '';
            }
        });
    }
    
    // 复制结果按钮
    const copyResultsBtn = document.getElementById('copy-test-results-btn');
    if (copyResultsBtn) {
        copyResultsBtn.addEventListener('click', async () => {
            const resultsContent = document.getElementById('test-results-content');
            if (!resultsContent || !resultsContent.textContent) {
                alert('没有可复制的内容');
                return;
            }
            
            try {
                await navigator.clipboard.writeText(resultsContent.textContent);
                const originalText = copyResultsBtn.innerHTML;
                copyResultsBtn.innerHTML = '<span>✅</span><span>已复制</span>';
                setTimeout(() => {
                    copyResultsBtn.innerHTML = originalText;
                }, 2000);
            } catch (err) {
                console.error('[关键字识别测试] 复制失败:', err);
                alert('复制失败: ' + err.message);
            }
        });
    }
    
    // 关闭按钮
    const closeBtn = document.getElementById('close-keyword-recognition-test-panel');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            const panel = document.getElementById('keyword-recognition-test-panel');
            if (panel) {
                panel.style.display = 'none';
            }
        });
    }
    
    // ESC键关闭
    const panel = document.getElementById('keyword-recognition-test-panel');
    if (panel) {
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && panel.style.display === 'flex') {
                panel.style.display = 'none';
            }
        });
    }
}

/**
 * 执行关键字识别测试
 */
async function runKeywordRecognitionTest() {
    const ruleSelect = document.getElementById('test-rule-select');
    const workflowSelect = document.getElementById('test-workflow-select');
    const stepSelect = document.getElementById('test-step-select');
    const testContentInput = document.getElementById('test-content-input');
    const resultsContent = document.getElementById('test-results-content');
    const executionMode = document.querySelector('input[name="test-execution-mode"]:checked')?.value || 'sequential';
    
    if (!ruleSelect || !workflowSelect || !stepSelect || !testContentInput || !resultsContent) {
        console.error('[关键字识别测试] 测试面板元素不存在');
        return;
    }
    
    const selectedRuleId = ruleSelect.value || null;
    const workflowName = workflowSelect.value;
    const stepIndex = stepSelect.value;
    const testContent = testContentInput.value.trim();
    
    // 禁用执行按钮，防止重复执行
    const runTestBtn = document.getElementById('run-keyword-test-btn');
    if (runTestBtn) {
        runTestBtn.disabled = true;
        runTestBtn.textContent = '⏳ 执行中...';
    }
    
    try {
        // 清空之前的结果
        resultsContent.textContent = '';
        
        // 如果选择了工作流，执行工作流测试
        if (workflowName) {
            await runWorkflowTest(workflowName, stepIndex, testContent, executionMode, resultsContent, selectedRuleId);
        } else {
            // 否则执行简单的关键字识别测试
            await runSimpleKeywordTest(testContent, resultsContent, selectedRuleId);
        }
    } catch (err) {
        console.error('[关键字识别测试] 测试执行失败:', err);
        const errorMsg = `❌ 测试执行失败: ${err.message}\n${err.stack ? err.stack.substring(0, 500) : ''}`;
        resultsContent.textContent = (resultsContent.textContent || '') + '\n' + errorMsg;
    } finally {
        // 恢复执行按钮
        if (runTestBtn) {
            runTestBtn.disabled = false;
            runTestBtn.innerHTML = '<span>▶️</span><span>执行测试</span>';
        }
        
        // 滚动到底部（测试完成后）
        if (resultsContent) {
            requestAnimationFrame(() => {
                resultsContent.scrollTop = resultsContent.scrollHeight;
            });
        }
    }
}

/**
 * 执行简单关键字识别测试（不涉及工作流）
 */
async function runSimpleKeywordTest(testContent, resultsContent, ruleId = null) {
    if (!testContent) {
        appendResult(resultsContent, '❌ 请输入测试内容\n');
        return;
    }
    
    appendResult(resultsContent, '=== 关键字识别测试结果 ===\n\n');
    appendResult(resultsContent, `测试时间: ${new Date().toLocaleString()}\n`);
    if (ruleId) {
        const rules = await getAllRecognitionRules();
        const rule = rules.find(r => r.id === ruleId);
        appendResult(resultsContent, `测试规则: ${rule ? rule.title : ruleId}\n`);
    } else {
        appendResult(resultsContent, `测试规则: 所有启用的规则\n`);
    }
    appendResult(resultsContent, `测试内容长度: ${testContent.length} 字符\n\n`);
    
    // 检测关键字
    appendResult(resultsContent, '--- 步骤1: 关键字检测 ---\n');
    try {
        const detectionResult = await detectKeywordRecognition(testContent, ruleId);
        
        if (!detectionResult || !detectionResult.detected) {
            appendResult(resultsContent, '❌ 未检测到任何关键字\n\n');
        } else {
            // 统计信息
            const totalKeywords = detectionResult.keywords.length;
            const totalMatches = detectionResult.matches.length;
            appendResult(resultsContent, `✅ 共检测到 ${totalKeywords} 个关键字，${totalMatches} 个匹配\n`);
            appendResult(resultsContent, `其中规则: ${detectionResult.results.map(r => `${r.ruleTitle} ${r.keywords.length}个`).join('，')}\n\n`);
            
            detectionResult.results.forEach((ruleResult, index) => {
                appendResult(resultsContent, `规则 ${index + 1}: ${ruleResult.ruleTitle}\n`);
                appendResult(resultsContent, `  规则ID: ${ruleResult.ruleId}\n`);
                appendResult(resultsContent, `  标识符: ${ruleResult.startSymbol}...${ruleResult.endSymbol}\n`);
                appendResult(resultsContent, `  关键字: ${ruleResult.keywords.join(', ')}\n`);
                appendResult(resultsContent, `  匹配数: ${ruleResult.matches.length}\n`);
                ruleResult.matches.forEach((match, mIndex) => {
                    appendResult(resultsContent, `    匹配 ${mIndex + 1}: "${match.fullMatch}" (位置: ${match.index})\n`);
                });
                appendResult(resultsContent, '\n');
            });
        }
    } catch (err) {
        appendResult(resultsContent, `❌ 关键字检测失败: ${err.message}\n\n`);
        console.error('[关键字识别测试] 检测失败:', err);
    }
    
    // 执行处理函数
    appendResult(resultsContent, '--- 步骤2: 执行处理函数 ---\n');
    await executeKeywordFunctions(testContent, resultsContent, '', ruleId);
    
    appendResult(resultsContent, '=== 测试完成 ===\n');
}

/**
 * 执行工作流测试
 */
async function runWorkflowTest(workflowName, stepIndex, testContent, executionMode, resultsContent, ruleId = null) {
    const { getWorkflow } = await import('../../core/api.js');
    const { parseWorkflowFormat } = await import('../workflowManager.js');
    const workflow = await getWorkflow(workflowName);
    const steps = parseWorkflowFormat(workflow.content);
    
    if (steps.length === 0) {
        appendResult(resultsContent, '❌ 工作流格式无效或为空\n');
        return;
    }
    
    appendResult(resultsContent, '=== 工作流关键字识别测试 ===\n\n');
    appendResult(resultsContent, `工作流: ${workflowName}\n`);
    appendResult(resultsContent, `执行模式: ${executionMode === 'sequential' ? '顺序执行（每步延迟5秒）' : '并发执行（满足依赖即执行）'}\n`);
    appendResult(resultsContent, `测试时间: ${new Date().toLocaleString()}\n\n`);
    
    // 确定要执行的步骤
    let stepsToExecute = [];
    if (stepIndex === '') {
        // 执行全部步骤
        stepsToExecute = steps.map((step, index) => ({ step, index }));
        appendResult(resultsContent, `执行范围: 全部 ${steps.length} 个步骤\n\n`);
    } else {
        // 执行单个步骤
        const stepIndexNum = parseInt(stepIndex);
        if (stepIndexNum >= 0 && stepIndexNum < steps.length) {
            stepsToExecute = [{ step: steps[stepIndexNum], index: stepIndexNum }];
            appendResult(resultsContent, `执行范围: 步骤 ${stepIndexNum + 1} (${steps[stepIndexNum].viewId || steps[stepIndexNum].self})\n\n`);
        } else {
            appendResult(resultsContent, `❌ 步骤索引无效: ${stepIndex}\n`);
            return;
        }
    }
    
    // 构建步骤依赖图
    const stepMap = new Map();
    steps.forEach((step, index) => {
        const stepId = step.viewId || step.self;
        stepMap.set(stepId, { step, index });
    });
    
    const nodeOutputSteps = new Map();
    steps.forEach((step, index) => {
        const nextIds = step.viewNext || step.next || [];
        nextIds.forEach(nextId => {
            if (!nodeOutputSteps.has(nextId)) {
                nodeOutputSteps.set(nextId, new Set());
            }
            nodeOutputSteps.get(nextId).add(index);
        });
    });
    
    // 检查节点是否就绪
    const isNodeReady = (nodeId, executedSteps) => {
        const prevIds = stepMap.get(nodeId)?.step.viewPrev || stepMap.get(nodeId)?.step.prev || [];
        if (prevIds.length === 0) return true;
        
        return prevIds.every(prevId => {
            if (nodeOutputSteps.has(prevId)) {
                const outputStepIndices = nodeOutputSteps.get(prevId);
                return Array.from(outputStepIndices).every(idx => executedSteps.has(idx));
            }
            return executedSteps.has(stepMap.get(prevId)?.index);
        });
    };
    
    // 添加规则信息
    if (ruleId) {
        const rules = await getAllRecognitionRules();
        const rule = rules.find(r => r.id === ruleId);
        if (rule) {
            appendResult(resultsContent, `测试规则: ${rule.title}\n`);
        }
    }
    
    // 执行测试
    if (executionMode === 'sequential') {
        await runSequentialWorkflowTest(stepsToExecute, testContent, resultsContent, stepMap, nodeOutputSteps, isNodeReady, ruleId);
    } else {
        await runConcurrentWorkflowTest(stepsToExecute, testContent, resultsContent, stepMap, nodeOutputSteps, isNodeReady, ruleId);
    }
    
    appendResult(resultsContent, '\n=== 测试完成 ===\n');
}

/**
 * 顺序执行工作流测试（每步延迟5秒）
 */
async function runSequentialWorkflowTest(stepsToExecute, testContent, resultsContent, stepMap, nodeOutputSteps, isNodeReady, ruleId = null) {
    const executedSteps = new Set();
    const stepResults = {};
    
    appendResult(resultsContent, '--- 顺序执行模式 ---\n\n');
    
    for (let i = 0; i < stepsToExecute.length; i++) {
        const { step, index } = stepsToExecute[i];
        const stepId = step.viewId || step.self;
        
        appendResult(resultsContent, `[${new Date().toLocaleTimeString()}] 执行步骤 ${index + 1}/${stepsToExecute.length}: ${stepId}\n`);
        
        // 检查依赖
        const prevIds = step.viewPrev || step.prev || [];
        if (prevIds.length > 0) {
            appendResult(resultsContent, `  前置节点: ${prevIds.join(', ')}\n`);
        }
        
        // 模拟步骤执行（使用测试内容作为AI回复）
        const stepResult = await executeStepTest(step, stepResults, testContent, index, resultsContent, ruleId);
        stepResults[stepId] = stepResult;
        executedSteps.add(index);
        
        appendResult(resultsContent, `  ✅ 步骤 ${index + 1} 执行完成\n\n`);
        
        // 延迟5秒（最后一步不延迟）
        if (i < stepsToExecute.length - 1) {
            appendResult(resultsContent, `  ⏳ 等待 5 秒后执行下一步...\n\n`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    
    appendResult(resultsContent, `\n顺序执行完成: 共执行 ${stepsToExecute.length} 个步骤\n`);
}

/**
 * 并发执行工作流测试（满足依赖即执行）
 */
async function runConcurrentWorkflowTest(stepsToExecute, testContent, resultsContent, stepMap, nodeOutputSteps, isNodeReady, ruleId = null) {
    const executedSteps = new Set();
    const executingSteps = new Set();
    const stepResults = {};
    const allSteps = stepsToExecute.map(item => item.step);
    
    appendResult(resultsContent, '--- 并发执行模式 ---\n\n');
    
    // 如果指定了单个步骤，直接执行
    if (stepsToExecute.length === 1) {
        const { step, index } = stepsToExecute[0];
        const stepId = step.viewId || step.self;
        appendResult(resultsContent, `[${new Date().toLocaleTimeString()}] 执行步骤 ${index + 1}: ${stepId}\n`);
        const stepResult = await executeStepTest(step, stepResults, testContent, index, resultsContent);
        stepResults[stepId] = stepResult;
        executedSteps.add(index);
        appendResult(resultsContent, `  ✅ 步骤 ${index + 1} 执行完成\n\n`);
        return;
    }
    
    // 并发执行所有步骤
    const executionPromises = stepsToExecute.map(async ({ step, index }) => {
        const stepId = step.viewId || step.self;
        
        // 等待依赖满足
        const prevIds = step.viewPrev || step.prev || [];
        if (prevIds.length > 0) {
            while (!isNodeReady(stepId, executedSteps)) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        // 检查是否正在执行
        if (executingSteps.has(index)) {
            return;
        }
        
        executingSteps.add(index);
        const startTime = Date.now();
        appendResult(resultsContent, `[${new Date().toLocaleTimeString()}] 🚀 开始执行步骤 ${index + 1}: ${stepId}\n`);
        
        try {
            const stepResult = await executeStepTest(step, stepResults, testContent, index, resultsContent, ruleId);
            stepResults[stepId] = stepResult;
            executedSteps.add(index);
            
            const duration = Date.now() - startTime;
            appendResult(resultsContent, `[${new Date().toLocaleTimeString()}] ✅ 步骤 ${index + 1} 执行完成 (耗时: ${duration}ms)\n\n`);
        } catch (err) {
            const duration = Date.now() - startTime;
            appendResult(resultsContent, `[${new Date().toLocaleTimeString()}] ❌ 步骤 ${index + 1} 执行失败: ${err.message} (耗时: ${duration}ms)\n\n`);
            console.error(`[关键字识别测试] 步骤 ${index + 1} 执行失败:`, err);
        } finally {
            executingSteps.delete(index);
        }
    });
    
    await Promise.all(executionPromises);
    
    appendResult(resultsContent, `\n并发执行完成: 共执行 ${executedSteps.size} 个步骤\n`);
}

/**
 * 执行单个步骤的测试
 */
async function executeStepTest(step, stepResults, testContent, stepIndex, resultsContent, ruleId = null) {
    const stepId = step.viewId || step.self;
    
    // 模拟读取视图内容
    const { readCurrentView } = await import('../viewManager.js');
    let viewData;
    try {
        viewData = await readCurrentView(stepId);
    } catch (err) {
        viewData = { content: `[测试模式] 视图 ${stepId} 的内容`, prompt: null };
    }
    
    // 使用测试内容作为AI回复
    const aiResponse = testContent;
    
    // 检测关键字并执行处理函数
    appendResult(resultsContent, `  检测关键字...\n`);
    const detectionResult = await detectKeywordRecognition(aiResponse, ruleId);
    
    if (detectionResult && detectionResult.detected) {
        appendResult(resultsContent, `  ✅ 检测到 ${detectionResult.results.length} 个规则的关键字\n`);
        await executeKeywordFunctions(aiResponse, resultsContent, '    ', ruleId);
    } else {
        appendResult(resultsContent, `  ⚠️ 未检测到关键字\n`);
    }
    
    return aiResponse;
}

/**
 * 执行关键字处理函数
 */
async function executeKeywordFunctions(testContent, resultsContent, indent = '', ruleId = null) {
    try {
        const detectionResult = await detectKeywordRecognition(testContent, ruleId);
        
        if (detectionResult && detectionResult.detected && detectionResult.results.length > 0) {
            const keywordManager = await import('./keywordRecognitionManager.js');
            const { getAllRecognitionRules } = await import('./keywordRecognitionManager.js');
            const rules = await getAllRecognitionRules();
            
            let executedCount = 0;
            let successCount = 0;
            
            for (const ruleResult of detectionResult.results) {
                const rule = rules.find(r => r.id === ruleResult.ruleId);
                if (!rule) {
                    appendResult(resultsContent, `${indent}⚠️ 规则 ${ruleResult.ruleId} 不存在，跳过\n`);
                    continue;
                }
                
                const functionNameBase = (rule.title || 'Keyword').replace(/[^a-zA-Z0-9]/g, '');
                const processFunctionName = `process${functionNameBase}Recognition`;
                
                // 智能查找处理函数
                const functionInfo = await findProcessFunction(keywordManager, ruleResult.ruleId, processFunctionName);
                
                if (!functionInfo) {
                    appendResult(resultsContent, `${indent}⚠️ 未找到处理函数: ${processFunctionName}\n`);
                    appendResult(resultsContent, `${indent}  提示: 请确保已定义标准函数 ${processFunctionName}，或在用户代码块中导出处理函数\n`);
                    continue;
                }
                
                executedCount++;
                const sourceLabel = functionInfo.source === 'standard' ? '标准函数' : '用户代码块';
                appendResult(resultsContent, `${indent}执行函数: ${functionInfo.functionName} (${sourceLabel})\n`);
                appendResult(resultsContent, `${indent}  规则: ${rule.title}\n`);
                appendResult(resultsContent, `${indent}  关键字: ${ruleResult.keywords.join(', ')}\n`);
                
                try {
                    const functionResult = await functionInfo.function(
                        testContent,
                        ruleResult.ruleId,
                        ruleResult.keywords,
                        ruleResult.matches || []
                    );
                    
                    appendResult(resultsContent, `${indent}  ✅ 执行成功\n`);
                    if (functionResult !== undefined && functionResult !== null) {
                        if (typeof functionResult === 'string') {
                            appendResult(resultsContent, `${indent}  返回: ${functionResult.substring(0, 100)}${functionResult.length > 100 ? '...' : ''}\n`);
                        } else if (typeof functionResult === 'object') {
                            appendResult(resultsContent, `${indent}  返回: ${JSON.stringify(functionResult).substring(0, 200)}${JSON.stringify(functionResult).length > 200 ? '...' : ''}\n`);
                        }
                    }
                    successCount++;
                } catch (funcErr) {
                    appendResult(resultsContent, `${indent}  ❌ 执行失败: ${funcErr.message}\n`);
                    console.error('[关键字识别测试] 函数执行失败:', funcErr);
                }
            }
            
            if (executedCount > 0) {
                appendResult(resultsContent, `${indent}执行统计: ${successCount}/${executedCount} 个函数执行成功\n`);
            }
        }
    } catch (err) {
        appendResult(resultsContent, `${indent}❌ 执行处理函数失败: ${err.message}\n`);
        console.error('[关键字识别测试] 执行失败:', err);
    }
}

/**
 * 追加测试结果（实时更新）
 * 使用防抖和批量更新来减少滚动条跳动
 */
let resultUpdateQueue = [];
let resultUpdateTimer = null;

function appendResult(resultsContent, text) {
    if (!resultsContent) return;
    
    // 将更新加入队列
    resultUpdateQueue.push(text);
    
    // 清除之前的定时器
    if (resultUpdateTimer) {
        clearTimeout(resultUpdateTimer);
    }
    
    // 使用防抖，批量更新DOM
    resultUpdateTimer = setTimeout(() => {
        if (resultUpdateQueue.length === 0) return;
        
        // 批量更新文本内容
        const batchText = resultUpdateQueue.join('');
        resultUpdateQueue = [];
        
        // 检查用户是否正在滚动（如果滚动位置不在底部，说明用户在查看之前的内容，不自动滚动）
        const wasAtBottom = resultsContent.scrollHeight - resultsContent.scrollTop <= resultsContent.clientHeight + 10;
        
        // 更新内容
        resultsContent.textContent += batchText;
        
        // 只有在用户已经在底部时才自动滚动到底部
        if (wasAtBottom) {
            requestAnimationFrame(() => {
                resultsContent.scrollTop = resultsContent.scrollHeight;
            });
        }
        
        resultUpdateTimer = null;
    }, 50); // 50ms防抖延迟
}

/**
 * 页面加载时检查和清理重复的函数声明
 * 这个函数在页面初始化时运行，确保代码中没有重复的函数定义
 */
async function cleanupDuplicateFunctionsOnLoad() {
    try {
        const targetFilePath = 'js/modules/usage/keywordRecognitionManager.js';
        
        // 读取文件内容
        let fileContent = '';
        try {
            fileContent = await getFile(targetFilePath);
            if (fileContent.trim().startsWith('{') && fileContent.includes('"error"')) {
                return; // 文件不存在或读取失败，不处理
            }
        } catch (err) {
            console.warn('[关键字识别管理] 页面加载时读取文件失败:', err);
            return;
        }
        
        if (!fileContent) return;
        
        // 提取用户代码块
        const userBlocks = extractUserCodeBlocks(fileContent);
        if (userBlocks.length === 0) return; // 没有用户代码，不需要清理
        
        // 合并所有用户代码
        const allUserCode = userBlocks.map(block => block.code).join('\n\n');
        
        // 解析用户代码中的所有函数
        const userCodeFunctions = parseCodeFunctions(allUserCode);
        
        // 找到用户代码块的结束位置（最后一个用户代码块的结束位置）
        const lastUserBlock = userBlocks[userBlocks.length - 1];
        const beforeUserCode = fileContent.substring(0, userBlocks[0].start);
        
        // 在用户代码之前的代码中查找重复的函数定义
        let cleanedBeforeCode = beforeUserCode;
        let hasChanges = false;
        
        for (const funcName of userCodeFunctions.functions) {
            const funcLocation = findFunctionInCode(cleanedBeforeCode, funcName);
            if (funcLocation) {
                // 发现重复的函数定义，移除它
                cleanedBeforeCode = removeCodeBlock(cleanedBeforeCode, funcLocation.start, funcLocation.end);
                hasChanges = true;
                console.log(`[关键字识别管理] 页面加载时移除重复函数: ${funcName}`);
            }
        }
        
        // 如果有变化，重新组合文件内容并保存
        if (hasChanges) {
            // 重新读取完整内容以确保准确
            const fullContent = await getFile(targetFilePath);
            const userCodeSection = fullContent.substring(userBlocks[0].start, lastUserBlock.end);
            const afterUserCode = fullContent.substring(lastUserBlock.end);
            
            // 确保代码块之间有正确的分隔
            let newContent = cleanedBeforeCode;
            if (!newContent.endsWith('\n')) {
                newContent += '\n';
            }
            newContent += userCodeSection;
            if (!afterUserCode.startsWith('\n')) {
                newContent += '\n';
            }
            newContent += afterUserCode;
            
            // 保存清理后的文件
            await saveFile(targetFilePath, newContent);
            console.log('[关键字识别管理] 页面加载时已清理重复函数定义');
        }
        
    } catch (err) {
        console.error('[关键字识别管理] 页面加载时清理重复函数失败:', err);
        // 不抛出错误，避免影响页面正常加载
    }
}

/**
 * 复制当前规则的代码块到剪贴板
 */
export async function copyKeywordRecognitionCodeBlock() {
    if (!currentEditingRule || !currentEditingRule.id) {
        alert('请先选择要复制的规则');
        return;
    }
    
    try {
        const ruleId = currentEditingRule.id;
        let codeToCopy = '';
        
        // 首先尝试从函数文件中读取
        const indexFilePath = `${FUNCTIONS_DIR}/.index.json`;
        try {
            const indexContent = await getFile(indexFilePath);
            if (indexContent && (!indexContent.trim().startsWith('{') || !indexContent.includes('"error"'))) {
                const indexData = JSON.parse(indexContent);
                if (indexData[ruleId] && Array.isArray(indexData[ruleId])) {
                    // 从函数文件中读取所有函数代码
                    const functionCodes = [];
                    for (const funcNameOrFile of indexData[ruleId]) {
                        const filePath = funcNameOrFile.endsWith('.js') 
                            ? `${FUNCTIONS_DIR}/${funcNameOrFile}`
                            : `${FUNCTIONS_DIR}/${funcNameOrFile}.js`;
                        try {
                            const funcFileContent = await getFile(filePath);
                            // 移除注释行（规则ID、函数名、自动生成提示）
                            const cleanedFuncCode = funcFileContent
                                .split('\n')
                                .filter(line => !line.trim().startsWith('//'))
                                .join('\n')
                                .trim();
                            functionCodes.push(cleanedFuncCode);
                        } catch (err) {
                            console.warn(`[关键字识别管理] 读取函数文件失败: ${filePath}`, err);
                        }
                    }
                    codeToCopy = functionCodes.join('\n\n');
                }
            }
        } catch (err) {
            console.warn('[关键字识别管理] 读取索引文件失败，尝试从主文件读取:', err);
        }
        
        // 如果从函数文件读取失败，尝试从主文件读取（向后兼容）
        if (!codeToCopy) {
            const targetFilePath = 'js/modules/usage/keywordRecognitionManager.js';
            let existingContent = '';
            
            try {
                existingContent = await getFile(targetFilePath);
                if (existingContent.trim().startsWith('{') && existingContent.includes('"error"')) {
                    alert('当前规则没有保存的代码块');
                    return;
                }
            } catch (err) {
                alert('读取文件失败: ' + err.message);
                return;
            }
            
            const ruleBlocks = extractUserCodeBlocks(existingContent, ruleId);
            if (ruleBlocks.length === 0) {
                alert('当前规则没有保存的代码块');
                return;
            }
            
            // 获取代码块内容（不包含标记注释）
            const block = ruleBlocks[0];
            codeToCopy = block.code.trim();
        }
        
        if (!codeToCopy || codeToCopy.length === 0) {
            alert('当前规则没有保存的代码块');
            return;
        }
        
        await navigator.clipboard.writeText(codeToCopy);
        
        // 显示成功提示
        const copyBtn = document.getElementById('copy-keyword-recognition-code-block');
        if (copyBtn) {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = '✅ 已复制';
            setTimeout(() => {
                copyBtn.textContent = originalText;
            }, 2000);
        } else {
            alert('代码块已复制到剪贴板');
        }
    } catch (err) {
        console.error('[关键字识别管理] 复制代码块失败:', err);
        alert('复制失败: ' + err.message);
    }
}

/**
 * 导出当前规则（包含规则设置和代码块）
 */
export async function exportKeywordRecognitionRule() {
    if (!currentEditingRule || !currentEditingRule.id) {
        alert('请先选择要导出的规则');
        return;
    }
    
    try {
        // 获取规则设置
        const titleInput = document.getElementById('keyword-recognition-rule-title');
        const startSymbolInput = document.getElementById('keyword-recognition-rule-start-symbol');
        const endSymbolInput = document.getElementById('keyword-recognition-rule-end-symbol');
        const enabledInput = document.getElementById('keyword-recognition-rule-enabled');
        const descriptionInput = document.getElementById('keyword-recognition-rule-description');
        
        if (!titleInput || !startSymbolInput || !endSymbolInput || !enabledInput || !descriptionInput) {
            alert('无法获取规则设置');
            return;
        }
        
        const ruleData = {
            title: titleInput.value.trim(),
            startSymbol: startSymbolInput.value.trim(),
            endSymbol: endSymbolInput.value.trim(),
            enabled: enabledInput.checked,
            functionDescription: descriptionInput.value.trim(),
            ruleId: currentEditingRule.id,
            codeBlock: null
        };
        
        // 获取代码块
        const targetFilePath = 'js/modules/usage/keywordRecognitionManager.js';
        try {
            const existingContent = await getFile(targetFilePath);
            if (existingContent && !existingContent.trim().startsWith('{') || !existingContent.includes('"error"')) {
                const ruleBlocks = extractUserCodeBlocks(existingContent, currentEditingRule.id);
                if (ruleBlocks.length > 0) {
                    ruleData.codeBlock = ruleBlocks[0].code.trim();
                }
            }
        } catch (err) {
            console.warn('[关键字识别管理] 读取代码块失败:', err);
        }
        
        // 生成文件名：YYYY年MM月DD日HH时规则名.json
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(now.getHours()).padStart(2, '0');
        // 清理文件名中的非法字符
        const safeTitle = ruleData.title.replace(/[<>:"/\\|?*]/g, '_');
        const fileName = `${year}年${month}月${day}日${hour}时${safeTitle}.json`;
        
        // 导出JSON文件
        const dataStr = JSON.stringify(ruleData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        
        alert('规则导出成功！');
    } catch (err) {
        console.error('[关键字识别管理] 导出规则失败:', err);
        alert('导出失败: ' + err.message);
    }
}

/**
 * 导入规则（包含规则设置和代码块）
 */
export async function importKeywordRecognitionRule() {
    try {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            try {
                const text = await file.text();
                const ruleData = JSON.parse(text);
                
                // 验证数据格式
                if (!ruleData.title || ruleData.startSymbol === undefined || ruleData.endSymbol === undefined) {
                    alert('无效的规则文件格式');
                    return;
                }
                
                // 询问用户是否要导入
                const confirmMsg = `确定要导入规则"${ruleData.title}"吗？\n\n` +
                    `这将覆盖当前规则的所有设置和代码块。`;
                if (!confirm(confirmMsg)) {
                    return;
                }
                
                // 加载规则设置到表单
                const titleInput = document.getElementById('keyword-recognition-rule-title');
                const startSymbolInput = document.getElementById('keyword-recognition-rule-start-symbol');
                const endSymbolInput = document.getElementById('keyword-recognition-rule-end-symbol');
                const enabledInput = document.getElementById('keyword-recognition-rule-enabled');
                const descriptionInput = document.getElementById('keyword-recognition-rule-description');
                
                if (!titleInput || !startSymbolInput || !endSymbolInput || !enabledInput || !descriptionInput) {
                    alert('无法加载规则设置');
                    return;
                }
                
                titleInput.value = ruleData.title;
                startSymbolInput.value = ruleData.startSymbol;
                endSymbolInput.value = ruleData.endSymbol;
                enabledInput.checked = ruleData.enabled === true;
                descriptionInput.value = ruleData.functionDescription || '';
                
                // 如果有代码块，加载到代码编辑器
                if (ruleData.codeBlock && ruleData.codeBlock.trim()) {
                    const codeInput = document.getElementById('keyword-recognition-function-code-input');
                    if (codeInput) {
                        codeInput.value = ruleData.codeBlock;
                        // 如果代码编辑器面板未打开，自动打开
                        const codeEditorPanel = document.getElementById('keyword-recognition-function-code-editor-panel');
                        const codeEditorBtn = document.getElementById('keyword-recognition-function-code-editor-btn');
                        if (codeEditorPanel && codeEditorBtn && codeEditorPanel.style.display === 'none') {
                            codeEditorPanel.style.display = 'block';
                            codeEditorBtn.classList.add('btn-active');
                        }
                    }
                } else {
                    // 如果没有代码块，清空代码编辑器
                    const codeInput = document.getElementById('keyword-recognition-function-code-input');
                    if (codeInput) {
                        codeInput.value = '';
                    }
                }
                
                alert('规则导入成功！\n\n请点击"保存"按钮保存规则设置，如果导入了代码块，也需要点击"保存到文件"按钮保存代码。');
            } catch (err) {
                console.error('[关键字识别管理] 导入规则失败:', err);
                alert('导入失败: ' + err.message);
            }
        };
        input.click();
    } catch (err) {
        console.error('[关键字识别管理] 导入规则失败:', err);
        alert('导入失败: ' + err.message);
    }
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.editKeywordRecognitionRule = editKeywordRecognitionRule;
    window.deleteKeywordRecognitionRule = deleteKeywordRecognitionRule;
    window.renderRulesList = renderRulesList;
    window.showKeywordRecognitionFunctionTemplate = showKeywordRecognitionFunctionTemplate;
    window.saveKeywordRecognitionFunctionCode = saveKeywordRecognitionFunctionCode;
    window.clearKeywordRecognitionFunctionCode = clearKeywordRecognitionFunctionCode;
    window.showKeywordRecognitionTestPanel = showKeywordRecognitionTestPanel;
    
    // 页面加载时自动检查和清理重复的函数声明
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', cleanupDuplicateFunctionsOnLoad);
    } else {
        // 如果DOM已经加载完成，直接执行
        cleanupDuplicateFunctionsOnLoad();
    }
}


