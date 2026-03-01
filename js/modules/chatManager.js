/**
 * Chat管理模块
 * 负责Chat界面的管理、Agent配置、话题、群聊等功能
 */

import { state, saveStateToStorage, getViewById } from '../core/state.js';
import { getFile, saveFile } from '../core/api.js';
import { createStreamFileWriter } from './editor.js';
import { formatPromptContent } from '../utils/promptFormatter.js';

// Chat状态
const chatState = {
    currentAgent: null,
    currentTopic: null,
    currentGroup: null,
    agents: [],
    topics: [],
    groups: [],
    messages: {},
    messageTypes: [],
    isInitialized: false,
    currentLogAgent: null,
    logUpdateInterval: null,
    messageUpdateInterval: null
};

// 文件写入队列（多线程）
const writeQueues = new Map(); // {agentName: {queue: [], isWriting: false}}

/**
 * 初始化Chat模块
 */
export async function initChatManager() {
    if (chatState.isInitialized) return;
    
    // 加载Agent配置
    await loadAgents();
    
    // 加载消息类型
    await loadMessageTypes();
    
    // 加载话题和群聊
    await loadTopicsAndGroups();
    
    // 绑定事件
    bindChatEvents();
    
    // 初始化UI
    renderChatUI();
    
    chatState.isInitialized = true;
}

/**
 * 加载Agent配置
 */
async function loadAgents() {
    try {
        const saved = localStorage.getItem('chatAgents');
        if (saved) {
            chatState.agents = JSON.parse(saved);
        } else {
            // 默认Agent
            chatState.agents = [{
                name: '默认Agent',
                url: 'https://api.openai.com/v1/chat/completions',
                apiKey: '',
                prompt: '',
                model: 'gpt-3.5-turbo',
                enabledViews: [],
                writeConfig: {
                    saveDir: '',
                    namingRule: '{timestamp}_{agentName}',
                    fileTypes: ['.md', '.txt'],
                    startSymbol: '',
                    endSymbol: '',
                    keepOriginal: true,
                    saveNamingRule: '{filename}_{timestamp}',
                    prependFilename: true,
                    contentOrder: ['{message}']
                },
                userAvatar: null,
                agentAvatar: null
            }];
        }
    } catch (err) {
        console.error('加载Agent配置失败:', err);
        chatState.agents = [];
    }
}

/**
 * 保存Agent配置
 */
function saveAgents() {
    localStorage.setItem('chatAgents', JSON.stringify(chatState.agents));
}

/**
 * 加载消息类型
 */
async function loadMessageTypes() {
    try {
        const saved = localStorage.getItem('chatMessageTypes');
        if (saved) {
            chatState.messageTypes = JSON.parse(saved);
        } else {
            // 默认消息类型
            chatState.messageTypes = [
                {
                    name: '用户消息',
                    startSymbol: '{（',
                    endSymbol: '）:',
                    enabled: true,
                    detectPattern: /\+\(/,
                    endPattern: /\)\+/
                },
                {
                    name: 'Agent消息',
                    startSymbol: '{（',
                    endSymbol: '）:',
                    enabled: true,
                    detectPattern: /\+\(/,
                    endPattern: /\)\+/
                },
                {
                    name: '事件',
                    startSymbol: '[',
                    endSymbol: ']',
                    enabled: true,
                    detectPattern: /\[/,
                    endPattern: /\]/
                },
                {
                    name: '笔记',
                    startSymbol: '//',
                    endSymbol: '//',
                    enabled: true,
                    detectPattern: /\/\//,
                    endPattern: /\/\//
                }
            ];
        }
    } catch (err) {
        console.error('加载消息类型失败:', err);
        chatState.messageTypes = [];
    }
}

/**
 * 保存消息类型
 */
function saveMessageTypes() {
    localStorage.setItem('chatMessageTypes', JSON.stringify(chatState.messageTypes));
}

/**
 * 检测消息类型
 * 根据消息内容检测匹配的消息类型
 * @param {string} content - 消息内容
 * @returns {object|null} 匹配的消息类型和解析结果
 */
export function detectMessageType(content) {
    if (!content || typeof content !== 'string') return null;
    
    // 遍历所有启用的消息类型
    for (const msgType of chatState.messageTypes) {
        if (!msgType.enabled) continue;
        
        // 检测起始符和终止符
        const startSymbol = msgType.startSymbol || '';
        const endSymbol = msgType.endSymbol || '';
        
        if (!startSymbol || !endSymbol) continue;
        
        // 检测起始符前5个字符中是否有+(或+（（中英文括号都要检测）
        const startIndex = content.indexOf(startSymbol);
        if (startIndex >= 0) {
            // 检查起始符前5个字符
            const beforeStart = content.substring(Math.max(0, startIndex - 5), startIndex);
            // 检测+(或+（（支持中英文括号）
            const hasStartPattern = /\+[\(（]/.test(beforeStart);
            
            // 检测终止符后5个字符中是否有)+或）+（中英文括号都要检测）
            const endIndex = content.indexOf(endSymbol, startIndex);
            if (endIndex >= 0) {
                // 检查终止符后5个字符
                const afterEnd = content.substring(endIndex + endSymbol.length, Math.min(content.length, endIndex + endSymbol.length + 5));
                // 检测)+或）+（支持中英文括号）
                const hasEndPattern = /[\)）]\+/.test(afterEnd);
                
                if (hasStartPattern && hasEndPattern) {
                    // 解析消息内容
                    const parsed = parseMessageByType(content, msgType, startIndex, endIndex);
                    if (parsed) {
                        return {
                            type: msgType,
                            parsed: parsed
                        };
                    }
                }
            }
        }
        
        // 如果没有找到动态模式，尝试使用正则表达式模式匹配
        if (msgType.detectPattern && msgType.endPattern) {
            const detectMatch = content.match(msgType.detectPattern);
            const endMatch = content.match(msgType.endPattern);
            if (detectMatch && endMatch) {
                const parsed = parseMessageByType(content, msgType);
                if (parsed) {
                    return {
                        type: msgType,
                        parsed: parsed
                    };
                }
            }
        }
        
        // 如果没有找到动态模式，尝试直接匹配起始符和终止符
        if (content.includes(startSymbol) && content.includes(endSymbol)) {
            const parsed = parseMessageByType(content, msgType);
            if (parsed) {
                return {
                    type: msgType,
                    parsed: parsed
                };
            }
        }
    }
    
    return null;
}

/**
 * 根据消息类型解析消息内容
 * @param {string} content - 消息内容
 * @param {object} msgType - 消息类型配置
 * @param {number} startIndex - 起始位置（可选）
 * @param {number} endIndex - 结束位置（可选）
 * @returns {object|null} 解析结果
 */
function parseMessageByType(content, msgType, startIndex = -1, endIndex = -1) {
    const startSymbol = msgType.startSymbol || '';
    const endSymbol = msgType.endSymbol || '';
    
    if (startIndex < 0) {
        startIndex = content.indexOf(startSymbol);
    }
    if (endIndex < 0) {
        endIndex = content.indexOf(endSymbol, startIndex);
    }
    
    if (startIndex < 0 || endIndex < 0) return null;
    
    // 提取消息内容
    const messageContent = content.substring(startIndex + startSymbol.length, endIndex);
    
    // 根据消息类型名称进行不同的解析
    if (msgType.name === '用户消息' || msgType.name === 'Agent消息') {
        // 格式：{（用户名）：消息}+时间戳；
        const match = messageContent.match(/^（([^）]+)）：(.+)$/);
        if (match) {
            return {
                sender: match[1],
                content: match[2],
                timestamp: extractTimestamp(content, endIndex)
            };
        }
    } else if (msgType.name === '事件') {
        // 格式：[标题]+（内容）+{参与者：(Agent名)+（用户名）}+{发起者：(Agent名)}
        const titleMatch = messageContent.match(/^([^\]]+)\]/);
        const contentMatch = messageContent.match(/\]\+（([^）]+)）/);
        const participantsMatch = content.match(/\{参与者：([^}]+)\}/);
        const initiatorMatch = content.match(/\{发起者：([^}]+)\}/);
        
        return {
            title: titleMatch ? titleMatch[1] : '',
            content: contentMatch ? contentMatch[1] : '',
            participants: participantsMatch ? participantsMatch[1].split('+').map(p => p.trim()) : [],
            initiator: initiatorMatch ? initiatorMatch[1] : ''
        };
    } else if (msgType.name === '笔记') {
        // 格式：//(Agent名)：（内容）+事件的名[标题]+时间戳//
        // 修复正则表达式：使用非贪婪匹配，正确转义特殊字符
        const match = messageContent.match(/^([^：]+)：（(.+?)\+事件的名\[([^\]]+)\]\+\d+)$/);
        if (match) {
            return {
                agent: match[1],
                content: match[2],
                eventTitle: match[3],
                timestamp: extractTimestamp(content, endIndex)
            };
        }
    }
    
    return {
        content: messageContent,
        raw: content
    };
}

/**
 * 从内容中提取时间戳
 * @param {string} content - 消息内容
 * @param {number} endIndex - 结束位置
 * @returns {number|null} 时间戳
 */
function extractTimestamp(content, endIndex) {
    // 查找时间戳模式：+数字；
    const afterEnd = content.substring(endIndex);
    const timestampMatch = afterEnd.match(/\+(\d+)；/);
    if (timestampMatch) {
        return parseInt(timestampMatch[1]);
    }
    return Date.now();
}

/**
 * 显示消息类型管理面板
 */
export function showMessageTypePanel() {
    const panel = document.getElementById('message-type-panel');
    if (!panel) return;
    
    panel.style.display = 'flex';
    renderMessageTypesList();
    renderMessageTypeConfig();
}

/**
 * 渲染消息类型列表
 */
function renderMessageTypesList() {
    const list = document.getElementById('message-types-list');
    if (!list) return;
    
    list.innerHTML = '';
    
    if (chatState.messageTypes.length === 0) {
        list.innerHTML = '<div style="color: var(--text-muted); padding: 10px; text-align: center;">暂无消息类型</div>';
        return;
    }
    
    chatState.messageTypes.forEach((msgType, index) => {
        const item = document.createElement('div');
        item.className = 'panel-list-item';
        item.style.cssText = 'padding: 12px; border: 1px solid var(--border); border-radius: var(--border-radius); margin-bottom: 8px; cursor: pointer; background: var(--surface-1); transition: all 0.2s;';
        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">${msgType.name}</div>
                    <div style="font-size: 12px; color: var(--text-muted);">${msgType.startSymbol}...${msgType.endSymbol}</div>
                </div>
                <label class="toggle-switch" style="margin: 0;" onclick="event.stopPropagation();">
                    <input type="checkbox" ${msgType.enabled ? 'checked' : ''} onchange="window.toggleMessageType(${index}, this.checked)">
                    <span class="toggle-slider"></span>
                </label>
            </div>
        `;
        item.addEventListener('click', () => {
            selectMessageTypeForEdit(index);
        });
        list.appendChild(item);
    });
}

/**
 * 选择消息类型进行编辑
 */
function selectMessageTypeForEdit(index) {
    if (index < 0 || index >= chatState.messageTypes.length) return;
    
    const msgType = chatState.messageTypes[index];
    renderMessageTypeConfigForm(msgType, index);
}

/**
 * 渲染消息类型配置表单
 */
function renderMessageTypeConfigForm(msgType, index) {
    const configEl = document.getElementById('message-type-config');
    if (!configEl) return;
    
    configEl.innerHTML = `
        <div class="form-section">
            <label class="form-label">类型名称</label>
            <input type="text" id="msg-type-name" value="${msgType.name || ''}" class="form-input" placeholder="例如：用户消息">
        </div>
        <div class="form-section">
            <label class="form-label">起始符</label>
            <input type="text" id="msg-type-start" value="${msgType.startSymbol || ''}" class="form-input" placeholder="例如：{（">
            <div class="form-hint">起始符的前5个字符中需要包含+(或+（（中文或英文括号）</div>
        </div>
        <div class="form-section">
            <label class="form-label">终止符</label>
            <input type="text" id="msg-type-end" value="${msgType.endSymbol || ''}" class="form-input" placeholder="例如：）:">
            <div class="form-hint">终止符的后5个字符中需要包含)+或）+</div>
        </div>
        <div class="form-section">
            <label class="form-label">检测模式（正则表达式）</label>
            <input type="text" id="msg-type-detect" value="${msgType.detectPattern ? msgType.detectPattern.toString().slice(1, -1) : ''}" class="form-input" placeholder="例如：\\+\\(">
            <div class="form-hint">用于检测消息类型的正则表达式模式</div>
        </div>
        <div class="form-section">
            <label class="form-label">结束模式（正则表达式）</label>
            <input type="text" id="msg-type-end-pattern" value="${msgType.endPattern ? msgType.endPattern.toString().slice(1, -1) : ''}" class="form-input" placeholder="例如：\\)\\+">
            <div class="form-hint">用于检测消息结束的正则表达式模式</div>
        </div>
        <div class="form-section">
            <label class="form-label">启用状态</label>
            <label class="toggle-switch">
                <input type="checkbox" id="msg-type-enabled" ${msgType.enabled !== false ? 'checked' : ''}>
                <span class="toggle-slider"></span>
            </label>
            <div class="form-hint">是否启用此消息类型的检测</div>
        </div>
        <div class="form-section">
            <label class="form-label">追加到提示词</label>
            <label class="toggle-switch">
                <input type="checkbox" id="msg-type-append-prompt" ${msgType.appendToPrompt !== false ? 'checked' : ''}>
                <span class="toggle-slider"></span>
            </label>
            <div class="form-hint">是否在发送给AI的提示词中追加此消息类型的说明（默认开启）</div>
        </div>
        <div class="form-section">
            <label class="form-label">提示词追加内容</label>
            <textarea id="msg-type-prompt-content" class="form-textarea" placeholder="当启用"追加到提示词"时，此内容会被追加到提示词后面">${msgType.promptContent || ''}</textarea>
        </div>
        <input type="hidden" id="msg-type-index" value="${index}">
    `;
}

/**
 * 保存消息类型配置
 */
function saveMessageTypeConfig() {
    const nameInput = document.getElementById('msg-type-name');
    const startInput = document.getElementById('msg-type-start');
    const endInput = document.getElementById('msg-type-end');
    const detectInput = document.getElementById('msg-type-detect');
    const endPatternInput = document.getElementById('msg-type-end-pattern');
    const enabledInput = document.getElementById('msg-type-enabled');
    const appendPromptInput = document.getElementById('msg-type-append-prompt');
    const promptContentInput = document.getElementById('msg-type-prompt-content');
    const indexInput = document.getElementById('msg-type-index');
    
    if (!nameInput || !startInput || !endInput) {
        alert('请填写必填项');
        return;
    }
    
    const name = nameInput.value.trim();
    const startSymbol = startInput.value.trim();
    const endSymbol = endInput.value.trim();
    const detectPattern = detectInput ? new RegExp(detectInput.value.trim() || '\\+\\(') : /\+\(/;
    const endPattern = endPatternInput ? new RegExp(endPatternInput.value.trim() || '\\)\\+') : /\)\+/;
    const enabled = enabledInput ? enabledInput.checked : true;
    const appendToPrompt = appendPromptInput ? appendPromptInput.checked : true;
    const promptContent = promptContentInput ? promptContentInput.value.trim() : '';
    const index = indexInput ? parseInt(indexInput.value) : -1;
    
    if (!name) {
        alert('请填写类型名称');
        return;
    }
    
    if (!startSymbol || !endSymbol) {
        alert('请填写起始符和终止符');
        return;
    }
    
    const msgType = {
        name,
        startSymbol,
        endSymbol,
        detectPattern,
        endPattern,
        enabled,
        appendToPrompt,
        promptContent
    };
    
    if (index >= 0 && index < chatState.messageTypes.length) {
        // 更新现有类型
        chatState.messageTypes[index] = msgType;
    } else {
        // 新建类型
        chatState.messageTypes.push(msgType);
    }
    
    saveMessageTypes();
    renderMessageTypesList();
    renderMessageTypeConfig();
    
    alert('保存成功！');
}

/**
 * 切换消息类型启用状态
 */
export function toggleMessageType(index, enabled) {
    if (index < 0 || index >= chatState.messageTypes.length) return;
    
    chatState.messageTypes[index].enabled = enabled;
    saveMessageTypes();
    renderMessageTypesList();
}

/**
 * 新建消息类型
 */
function newMessageType() {
    const newType = {
        name: '',
        startSymbol: '',
        endSymbol: '',
        detectPattern: /\+\(/,
        endPattern: /\)\+/,
        enabled: true,
        appendToPrompt: true,
        promptContent: ''
    };
    
    chatState.messageTypes.push(newType);
    const index = chatState.messageTypes.length - 1;
    renderMessageTypesList();
    selectMessageTypeForEdit(index);
}

/**
 * 渲染消息类型配置（默认显示第一个）
 */
function renderMessageTypeConfig() {
    if (chatState.messageTypes.length > 0) {
        selectMessageTypeForEdit(0);
    } else {
        const configEl = document.getElementById('message-type-config');
        if (configEl) {
            configEl.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 40px;">请从左侧选择消息类型进行编辑，或点击"新建类型"创建新类型</p>';
        }
    }
}

/**
 * 在发送消息时，根据启用的消息类型追加提示词内容
 * @param {string} basePrompt - 基础提示词
 * @returns {string} 追加后的提示词
 */
export function appendMessageTypePrompts(basePrompt) {
    let prompt = basePrompt;
    
    for (const msgType of chatState.messageTypes) {
        if (msgType.enabled && msgType.appendToPrompt && msgType.promptContent) {
            prompt += '\n\n' + msgType.promptContent;
        }
    }
    
    return prompt;
}

/**
 * 加载话题和群聊
 */
async function loadTopicsAndGroups() {
    try {
        // 从Message文件夹加载（通过API）
        const messageDir = 'Message';
        
        // 尝试读取目录（如果不存在会创建）
        try {
            await getFile(messageDir + '/.keep'); // 尝试读取，如果失败则创建目录
        } catch (err) {
            // 目录不存在，稍后会在保存时创建
        }
        
        // 从localStorage加载话题和群聊列表
        const savedTopics = localStorage.getItem('chatTopics');
        const savedGroups = localStorage.getItem('chatGroups');
        
        if (savedTopics) {
            chatState.topics = JSON.parse(savedTopics);
        } else {
            chatState.topics = [];
        }
        
        if (savedGroups) {
            chatState.groups = JSON.parse(savedGroups);
        } else {
            chatState.groups = [];
        }
    } catch (err) {
        console.error('加载话题和群聊失败:', err);
        chatState.topics = [];
        chatState.groups = [];
    }
}

/**
 * 从内容中提取Agent名
 */
function extractAgentFromContent(content) {
    const match = content.match(/\{（([^）]+)）：/);
    return match ? match[1] : null;
}

/**
 * 从内容中提取多个Agent名
 */
function extractAgentsFromContent(content) {
    const match = content.match(/多Agent名：（([^）]+)）/);
    if (match) {
        return match[1].split('，').map(a => a.trim());
    }
    return [];
}

/**
 * 绑定Chat事件
 */
function bindChatEvents() {
    // 关闭按钮
    const closeBtn = document.getElementById('chat-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            toggleChatPanel();
        });
    }
    
    // 设置按钮
    const settingsBtn = document.getElementById('chat-settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            showChatSettings();
        });
    }
    
    // 新建话题按钮
    const newTopicBtn = document.getElementById('chat-new-topic-btn');
    if (newTopicBtn) {
        newTopicBtn.addEventListener('click', () => {
            createNewTopic();
        });
    }
    
    // 新建群聊按钮
    const newGroupBtn = document.getElementById('chat-new-group-btn');
    if (newGroupBtn) {
        newGroupBtn.addEventListener('click', () => {
            createNewGroup();
        });
    }
    
    // Agent选择器
    const agentSelect = document.getElementById('chat-agent-select');
    if (agentSelect) {
        agentSelect.addEventListener('change', (e) => {
            chatState.currentAgent = e.target.value;
            renderTopicsList();
        });
    }
    
    // 发送按钮
    const sendBtn = document.getElementById('chat-send-btn');
    if (sendBtn) {
        sendBtn.addEventListener('click', () => {
            sendMessage();
        });
    }
    
    // 输入框回车发送
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }
}

/**
 * 渲染Chat UI
 */
function renderChatUI() {
    renderAgentSelector();
    renderTopicsList();
    renderMessages();
}

/**
 * 渲染Agent选择器
 */
function renderAgentSelector() {
    const select = document.getElementById('chat-agent-select');
    if (!select) return;
    
    select.innerHTML = '<option value="">请选择Agent</option>';
    chatState.agents.forEach(agent => {
        const option = document.createElement('option');
        option.value = agent.name;
        option.textContent = agent.name;
        if (chatState.currentAgent === agent.name) {
            option.selected = true;
        }
        select.appendChild(option);
    });
    
    // 同时更新输入框上方的选择器
    updateAgentSelectorTop();
}

/**
 * 更新输入框上方的Agent选择器
 */
function updateAgentSelectorTop() {
    const selectTop = document.getElementById('chat-agent-select-top');
    if (!selectTop) return;
    
    selectTop.innerHTML = '<option value="">请选择Agent</option>';
    chatState.agents.forEach(agent => {
        const option = document.createElement('option');
        option.value = agent.name;
        option.textContent = agent.name;
        if (chatState.currentAgent === agent.name) {
            option.selected = true;
        }
        selectTop.appendChild(option);
    });
}

/**
 * 更新侧边栏的Agent选择器
 */
function updateAgentSelector() {
    const select = document.getElementById('chat-agent-select');
    if (!select) return;
    
    select.value = chatState.currentAgent || '';
}

/**
 * 渲染话题列表
 */
function renderTopicsList() {
    const listContent = document.getElementById('chat-list-content');
    if (!listContent) return;
    
    listContent.innerHTML = '';
    
    // 显示话题
    if (chatState.currentAgent) {
        const agentTopics = chatState.topics.filter(t => t.agent === chatState.currentAgent);
        agentTopics.forEach(topic => {
            const item = document.createElement('div');
            item.className = 'chat-topic-item';
            item.innerHTML = `
                <div class="chat-topic-name">${topic.name}</div>
                <div class="chat-topic-meta">话题</div>
            `;
            item.addEventListener('click', () => {
                loadTopic(topic);
            });
            listContent.appendChild(item);
        });
    }
    
    // 显示群聊
    chatState.groups.forEach(group => {
        const item = document.createElement('div');
        item.className = 'chat-topic-item';
        item.innerHTML = `
            <div class="chat-topic-name">${group.name}</div>
            <div class="chat-topic-meta">群聊 (${group.agents.length}个Agent)</div>
        `;
        item.addEventListener('click', () => {
            loadGroup(group);
        });
        listContent.appendChild(item);
    });
}

/**
 * 渲染消息
 */
function renderMessages() {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;
    
    const currentMessages = chatState.currentTopic 
        ? chatState.messages[chatState.currentTopic.name] || []
        : chatState.currentGroup
        ? chatState.messages[chatState.currentGroup.name] || []
        : [];
    
    messagesContainer.innerHTML = '';
    
    currentMessages.forEach(msg => {
        const msgEl = createMessageElement(msg);
        messagesContainer.appendChild(msgEl);
    });
    
    // 滚动到底部
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * 创建消息元素
 */
function createMessageElement(msg) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${msg.type || 'user'}`;
    
    const avatar = msg.type === 'user' 
        ? (chatState.currentAgent ? getAgentConfig(chatState.currentAgent)?.userAvatar : null)
        : (chatState.currentAgent ? getAgentConfig(chatState.currentAgent)?.agentAvatar : null);
    
    msgDiv.innerHTML = `
        <div class="chat-message-header">
            ${avatar ? `<img src="${avatar}" class="chat-message-avatar" alt="${msg.sender}">` : ''}
            <span class="chat-message-name">${msg.sender}</span>
            <span class="chat-message-time">${formatTime(msg.timestamp)}</span>
        </div>
        <div class="chat-message-content">${escapeHtml(msg.content)}</div>
    `;
    
    return msgDiv;
}

/**
 * 获取Agent配置
 */
function getAgentConfig(agentName) {
    return chatState.agents.find(a => a.name === agentName);
}

/**
 * 格式化时间
 */
function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

/**
 * HTML转义
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 切换Chat面板显示
 */
export function toggleChatPanel() {
    const panel = document.getElementById('chat-panel');
    if (!panel) return;
    
    if (panel.style.display === 'none' || !panel.style.display) {
        panel.style.display = 'flex';
        if (!chatState.isInitialized) {
            initChatManager();
        }
    } else {
        panel.style.display = 'none';
    }
}

/**
 * 显示Chat设置
 */
function showChatSettings() {
    const panel = document.getElementById('chat-settings-panel');
    if (!panel) return;
    
    panel.style.display = 'flex';
    renderChatSettings();
    
    // 绑定关闭按钮（如果还没绑定）
    const closeBtn = document.getElementById('close-chat-settings-panel');
    if (closeBtn && !closeBtn._bound) {
        closeBtn.addEventListener('click', () => {
            panel.style.display = 'none';
        });
        closeBtn._bound = true;
    }
}

/**
 * 渲染Chat设置
 */
function renderChatSettings() {
    renderAgentsList();
    renderAgentConfig();
}

/**
 * 渲染Agent列表
 */
function renderAgentsList() {
    const list = document.getElementById('chat-agents-list');
    if (!list) return;
    
    list.innerHTML = '';
    
    chatState.agents.forEach(agent => {
        const item = document.createElement('div');
        item.className = 'panel-list-item';
        item.textContent = agent.name;
        item.addEventListener('click', () => {
            selectAgentForEdit(agent.name);
        });
        list.appendChild(item);
    });
}

/**
 * 选择Agent进行编辑
 */
function selectAgentForEdit(agentName) {
    const agent = getAgentConfig(agentName);
    if (!agent) return;
    
    renderAgentConfigForm(agent);
}

/**
 * 渲染Agent配置表单
 */
function renderAgentConfigForm(agent) {
    const configEl = document.getElementById('chat-agent-config');
    if (!configEl) return;
    
    // 获取视图列表
    const views = state.views || [];
    
    configEl.innerHTML = `
        <div class="form-section">
            <label class="form-label">Agent名称</label>
            <input type="text" id="chat-agent-name" value="${agent.name}" class="form-input">
        </div>
        <div class="form-section">
            <label class="form-label">API URL</label>
            <input type="text" id="chat-agent-url" value="${agent.url}" class="form-input">
        </div>
        <div class="form-section">
            <label class="form-label">API Key</label>
            <input type="password" id="chat-agent-apikey" value="${agent.apiKey}" class="form-input">
        </div>
        <div class="form-section">
            <label class="form-label">提示词</label>
            <textarea id="chat-agent-prompt" class="form-textarea">${agent.prompt || ''}</textarea>
        </div>
        <div class="form-section">
            <label class="form-label">模型名</label>
            <input type="text" id="chat-agent-model" value="${agent.model}" class="form-input">
        </div>
        <div class="form-section">
            <label class="form-label">可读取的视图</label>
            <div id="chat-agent-views" class="form-checkbox-group">
                ${views.map(view => `
                    <label class="form-checkbox">
                        <input type="checkbox" value="${view.id}" ${agent.enabledViews?.includes(view.id) ? 'checked' : ''}>
                        <span>${view.id}</span>
                    </label>
                `).join('')}
            </div>
        </div>
        <div class="form-section">
            <label class="form-label">用户头像</label>
            <input type="file" id="chat-user-avatar" accept="image/*" class="form-input">
            ${agent.userAvatar ? `<img src="${agent.userAvatar}" style="max-width: 100px; margin-top: 8px;">` : ''}
        </div>
        <div class="form-section">
            <label class="form-label">Agent头像</label>
            <input type="file" id="chat-agent-avatar" accept="image/*" class="form-input">
            ${agent.agentAvatar ? `<img src="${agent.agentAvatar}" style="max-width: 100px; margin-top: 8px;">` : ''}
        </div>
        <div class="form-section">
            <button class="btn btn-secondary" id="chat-write-config-btn">配置写入操作</button>
        </div>
        <div class="form-section">
            <button class="btn btn-secondary" id="chat-view-log-btn">查看日志</button>
        </div>
    `;
    
    // 绑定查看日志按钮
    const viewLogBtn = document.getElementById('chat-view-log-btn');
    if (viewLogBtn) {
        viewLogBtn.addEventListener('click', () => {
            showAgentLogPanel(agent.name);
        });
    }
    
    // 绑定头像上传
    const userAvatarInput = document.getElementById('chat-user-avatar');
    if (userAvatarInput) {
        userAvatarInput.addEventListener('change', (e) => {
            handleAvatarUpload(e, 'user');
        });
    }
    
    const agentAvatarInput = document.getElementById('chat-agent-avatar');
    if (agentAvatarInput) {
        agentAvatarInput.addEventListener('change', (e) => {
            handleAvatarUpload(e, 'agent');
        });
    }
    
    // 绑定写入配置按钮
    const writeConfigBtn = document.getElementById('chat-write-config-btn');
    if (writeConfigBtn) {
        writeConfigBtn.addEventListener('click', () => {
            showWriteConfigPanel(agent);
        });
    }
}

/**
 * 处理头像上传
 */
function handleAvatarUpload(event, type) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const base64 = e.target.result;
        const agentName = document.getElementById('chat-agent-name')?.value;
        if (!agentName) return;
        
        const agent = getAgentConfig(agentName);
        if (!agent) return;
        
        if (type === 'user') {
            agent.userAvatar = base64;
        } else {
            agent.agentAvatar = base64;
        }
        
        saveAgents();
        renderAgentConfigForm(agent);
    };
    reader.readAsDataURL(file);
}

/**
 * 保存Agent配置
 */
function saveAgentConfig() {
    const nameInput = document.getElementById('chat-agent-name');
    const urlInput = document.getElementById('chat-agent-url');
    const apiKeyInput = document.getElementById('chat-agent-apikey');
    const promptInput = document.getElementById('chat-agent-prompt');
    const modelInput = document.getElementById('chat-agent-model');
    const viewsContainer = document.getElementById('chat-agent-views');
    
    if (!nameInput || !urlInput) {
        alert('请填写必填项');
        return;
    }
    
    const name = nameInput.value.trim();
    const url = urlInput.value.trim();
    const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
    const prompt = promptInput ? promptInput.value.trim() : '';
    const model = modelInput ? modelInput.value.trim() : 'gpt-3.5-turbo';
    
    if (!name) {
        alert('请填写Agent名称');
        return;
    }
    
    // 获取选中的视图
    const enabledViews = [];
    if (viewsContainer) {
        const checkboxes = viewsContainer.querySelectorAll('input[type="checkbox"]:checked');
        checkboxes.forEach(cb => {
            enabledViews.push(cb.value);
        });
    }
    
    // 查找现有Agent或创建新Agent
    let agent = chatState.agents.find(a => a.name === name);
    if (!agent) {
        agent = {
            name,
            url,
            apiKey,
            prompt,
            model,
            enabledViews,
            writeConfig: {
                saveDir: '',
                namingRule: '{timestamp}_{agentName}',
                fileTypes: ['.md', '.txt'],
                startSymbol: '',
                endSymbol: '',
                keepOriginal: true,
                saveNamingRule: '{filename}_{timestamp}',
                prependFilename: true,
                contentOrder: ['{message}']
            },
            userAvatar: null,
            agentAvatar: null
        };
        chatState.agents.push(agent);
    } else {
        agent.url = url;
        agent.apiKey = apiKey;
        agent.prompt = prompt;
        agent.model = model;
        agent.enabledViews = enabledViews;
    }
    
    saveAgents();
    renderAgentsList();
    renderAgentConfigForm(agent);
    renderAgentSelector(); // 更新Chat界面的Agent选择器
    updateAgentSelectorTop(); // 更新输入框上方的选择器
    
    alert('保存成功！');
}

/**
 * 创建新Agent
 */
function createNewAgent() {
    const newAgent = {
        name: `Agent${chatState.agents.length + 1}`,
        url: 'https://api.openai.com/v1/chat/completions',
        apiKey: '',
        prompt: '',
        model: 'gpt-3.5-turbo',
        enabledViews: [],
        writeConfig: {
            saveDir: '',
            namingRule: '{timestamp}_{agentName}',
            fileTypes: ['.md', '.txt'],
            startSymbol: '',
            endSymbol: '',
            keepOriginal: true,
            saveNamingRule: '{filename}_{timestamp}',
            prependFilename: true,
            contentOrder: ['{message}']
        },
        userAvatar: null,
        agentAvatar: null
    };
    
    chatState.agents.push(newAgent);
    saveAgents();
    renderAgentsList();
    selectAgentForEdit(newAgent.name);
}

/**
 * 显示写入配置面板
 */
function showWriteConfigPanel(agent) {
    const panel = document.getElementById('write-config-panel');
    if (!panel) return;
    
    panel.style.display = 'flex';
    renderWriteConfigForm(agent);
}

/**
 * 渲染写入配置表单
 */
function renderWriteConfigForm(agent) {
    const contentEl = document.getElementById('write-config-content');
    if (!contentEl) return;
    
    const writeConfig = agent.writeConfig || {
        saveDir: '',
        namingRule: '{timestamp}_{agentName}',
        fileTypes: ['.md', '.txt'],
        startSymbol: '',
        endSymbol: '',
        keepOriginal: true,
        saveNamingRule: '{filename}_{timestamp}',
        prependFilename: true,
        contentOrder: ['{message}']
    };
    
    // 获取所有消息类型用于内容顺序配置
    const messageTypeOptions = chatState.messageTypes.map(mt => ({
        value: `{${mt.name}}`,
        label: mt.name,
        type: 'messageType'
    }));
    
    // 构建内容顺序的可拖拽列表
    const contentOrderHtml = writeConfig.contentOrder.map((item, index) => {
        const isMessageType = messageTypeOptions.find(opt => opt.value === item);
        const displayText = isMessageType ? isMessageType.label : item;
        return `
            <div class="content-order-item" data-index="${index}" draggable="true">
                <span class="drag-handle">☰</span>
                <input type="text" value="${item}" class="content-order-input" data-index="${index}">
                <span class="item-label">${displayText}</span>
                <button class="btn-icon-small" onclick="removeContentOrderItem(${index})">×</button>
            </div>
        `;
    }).join('');
    
    contentEl.innerHTML = `
        <div class="form-section">
            <label class="form-label">保存目录</label>
            <input type="text" id="write-save-dir" value="${writeConfig.saveDir || ''}" class="form-input" placeholder="例如：chat/history">
            <div class="form-hint">相对于Message文件夹的路径</div>
        </div>
        <div class="form-section">
            <label class="form-label">命名规范</label>
            <input type="text" id="write-naming-rule" value="${writeConfig.namingRule || ''}" class="form-input" placeholder="例如：{timestamp}_{agentName}">
            <div class="form-hint">可用变量：{timestamp}, {agentName}, {date}, {time}</div>
        </div>
        <div class="form-section">
            <label class="form-label">要切割的文件类型</label>
            <div id="write-file-types" class="form-checkbox-group">
                <label class="form-checkbox">
                    <input type="checkbox" value=".md" ${writeConfig.fileTypes?.includes('.md') ? 'checked' : ''}>
                    <span>.md</span>
                </label>
                <label class="form-checkbox">
                    <input type="checkbox" value=".txt" ${writeConfig.fileTypes?.includes('.txt') ? 'checked' : ''}>
                    <span>.txt</span>
                </label>
            </div>
        </div>
        <div class="form-section">
            <label class="form-label">切割开始符</label>
            <input type="text" id="write-start-symbol" value="${writeConfig.startSymbol || ''}" class="form-input" placeholder="例如：[">
        </div>
        <div class="form-section">
            <label class="form-label">切割终止符</label>
            <input type="text" id="write-end-symbol" value="${writeConfig.endSymbol || ''}" class="form-input" placeholder="例如：]">
        </div>
        <div class="form-section">
            <label class="form-label">保留原文件</label>
            <label class="toggle-switch">
                <input type="checkbox" id="write-keep-original" ${writeConfig.keepOriginal !== false ? 'checked' : ''}>
                <span class="toggle-slider"></span>
            </label>
            <div class="form-hint">如果关闭，原文件将被软删除</div>
        </div>
        <div class="form-section">
            <label class="form-label">切割后保存的命名规范</label>
            <input type="text" id="write-save-naming-rule" value="${writeConfig.saveNamingRule || ''}" class="form-input" placeholder="例如：{filename}_{timestamp}">
        </div>
        <div class="form-section">
            <label class="form-label">在命名规范前拼接文件名</label>
            <label class="toggle-switch">
                <input type="checkbox" id="write-prepend-filename" ${writeConfig.prependFilename !== false ? 'checked' : ''}>
                <span class="toggle-slider"></span>
            </label>
        </div>
        <div class="form-section">
            <label class="form-label">拼接内容的顺序（可拖拽调整）</label>
            <div id="content-order-list" class="content-order-list">
                ${contentOrderHtml}
            </div>
            <div style="margin-top: 12px;">
                <select id="content-order-select" class="form-select" style="width: 200px; display: inline-block; margin-right: 8px;">
                    <option value="">选择消息类型或输入自定义</option>
                    ${messageTypeOptions.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('')}
                </select>
                <button class="btn btn-secondary" onclick="addContentOrderItem()">添加</button>
            </div>
            <div class="form-hint">可用变量：{message}, {timestamp}, {sender}, {content} 以及消息类型变量</div>
        </div>
        <input type="hidden" id="write-config-agent-name" value="${agent.name}">
    `;
    
    // 绑定拖拽事件
    setupContentOrderDragDrop();
    
    // 绑定保存按钮
    const saveBtn = document.getElementById('save-write-config-btn');
    if (saveBtn) {
        saveBtn.onclick = () => saveWriteConfig(agent.name);
    }
    
    // 绑定关闭按钮
    const closeBtn = document.getElementById('close-write-config-panel');
    if (closeBtn) {
        closeBtn.onclick = () => {
            panel.style.display = 'none';
        };
    }
}

/**
 * 设置内容顺序的拖拽功能
 */
function setupContentOrderDragDrop() {
    const list = document.getElementById('content-order-list');
    if (!list) return;
    
    let draggedElement = null;
    
    list.querySelectorAll('.content-order-item').forEach(item => {
        item.addEventListener('dragstart', (e) => {
            draggedElement = item;
            item.style.opacity = '0.5';
        });
        
        item.addEventListener('dragend', () => {
            if (draggedElement) {
                draggedElement.style.opacity = '1';
                draggedElement = null;
            }
        });
        
        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            const afterElement = getDragAfterElement(list, e.clientY);
            if (afterElement == null) {
                list.appendChild(draggedElement);
            } else {
                list.insertBefore(draggedElement, afterElement);
            }
        });
    });
}

/**
 * 获取拖拽后的元素位置
 */
function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.content-order-item:not(.dragging)')];
    
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

/**
 * 添加内容顺序项
 */
function addContentOrderItem() {
    const select = document.getElementById('content-order-select');
    const list = document.getElementById('content-order-list');
    if (!select || !list) return;
    
    const value = select.value.trim();
    if (!value) {
        // 允许用户输入自定义值
        const customValue = prompt('输入自定义内容（可用变量：{message}, {timestamp}, {sender}, {content}）:');
        if (customValue) {
            addOrderItemToList(list, customValue);
        }
    } else {
        addOrderItemToList(list, value);
    }
}

/**
 * 添加顺序项到列表
 */
function addOrderItemToList(list, value) {
    const index = list.children.length;
    const messageTypeOptions = chatState.messageTypes.map(mt => ({
        value: `{${mt.name}}`,
        label: mt.name
    }));
    const isMessageType = messageTypeOptions.find(opt => opt.value === value);
    const displayText = isMessageType ? isMessageType.label : value;
    
    const item = document.createElement('div');
    item.className = 'content-order-item';
    item.draggable = true;
    item.dataset.index = index;
    item.innerHTML = `
        <span class="drag-handle">☰</span>
        <input type="text" value="${value}" class="content-order-input" data-index="${index}">
        <span class="item-label">${displayText}</span>
        <button class="btn-icon-small" onclick="removeContentOrderItem(${index})">×</button>
    `;
    
    // 绑定拖拽事件
    item.addEventListener('dragstart', (e) => {
        item.style.opacity = '0.5';
    });
    item.addEventListener('dragend', () => {
        item.style.opacity = '1';
    });
    item.addEventListener('dragover', (e) => {
        e.preventDefault();
        const afterElement = getDragAfterElement(list, e.clientY);
        if (afterElement == null) {
            list.appendChild(item);
        } else {
            list.insertBefore(item, afterElement);
        }
    });
    
    list.appendChild(item);
    setupContentOrderDragDrop();
}

/**
 * 移除内容顺序项
 */
function removeContentOrderItem(index) {
    const list = document.getElementById('content-order-list');
    if (!list) return;
    
    const items = list.querySelectorAll('.content-order-item');
    if (index >= 0 && index < items.length) {
        items[index].remove();
        // 重新设置索引
        list.querySelectorAll('.content-order-item').forEach((item, i) => {
            item.dataset.index = i;
            const input = item.querySelector('.content-order-input');
            if (input) input.dataset.index = i;
        });
    }
}

/**
 * 保存写入配置
 */
function saveWriteConfig(agentName) {
    const agent = getAgentConfig(agentName);
    if (!agent) return;
    
    const saveDir = document.getElementById('write-save-dir')?.value.trim() || '';
    const namingRule = document.getElementById('write-naming-rule')?.value.trim() || '';
    const startSymbol = document.getElementById('write-start-symbol')?.value.trim() || '';
    const endSymbol = document.getElementById('write-end-symbol')?.value.trim() || '';
    const keepOriginal = document.getElementById('write-keep-original')?.checked !== false;
    const saveNamingRule = document.getElementById('write-save-naming-rule')?.value.trim() || '';
    const prependFilename = document.getElementById('write-prepend-filename')?.checked !== false;
    
    // 获取文件类型
    const fileTypes = [];
    const fileTypesContainer = document.getElementById('write-file-types');
    if (fileTypesContainer) {
        const checkboxes = fileTypesContainer.querySelectorAll('input[type="checkbox"]:checked');
        checkboxes.forEach(cb => fileTypes.push(cb.value));
    }
    
    // 获取内容顺序
    const contentOrder = [];
    const orderList = document.getElementById('content-order-list');
    if (orderList) {
        orderList.querySelectorAll('.content-order-input').forEach(input => {
            contentOrder.push(input.value.trim());
        });
    }
    
    if (!agent.writeConfig) {
        agent.writeConfig = {};
    }
    
    agent.writeConfig.saveDir = saveDir;
    agent.writeConfig.namingRule = namingRule;
    agent.writeConfig.fileTypes = fileTypes;
    agent.writeConfig.startSymbol = startSymbol;
    agent.writeConfig.endSymbol = endSymbol;
    agent.writeConfig.keepOriginal = keepOriginal;
    agent.writeConfig.saveNamingRule = saveNamingRule;
    agent.writeConfig.prependFilename = prependFilename;
    agent.writeConfig.contentOrder = contentOrder;
    
    saveAgents();
    
    alert('保存成功！');
    
    // 关闭面板
    const panel = document.getElementById('write-config-panel');
    if (panel) panel.style.display = 'none';
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.addContentOrderItem = addContentOrderItem;
    window.removeContentOrderItem = removeContentOrderItem;
}

/**
 * 创建新话题
 */
function createNewTopic() {
    if (!chatState.currentAgent) {
        alert('请先选择Agent');
        return;
    }
    
    const topicName = prompt('输入话题名称:');
    if (!topicName) return;
    
    const topic = {
        name: topicName,
        agent: chatState.currentAgent,
        path: null,
        messages: []
    };
    
    chatState.topics.push(topic);
    chatState.currentTopic = topic;
    chatState.messages[topicName] = [];
    
    renderTopicsList();
    renderMessages();
}

/**
 * 创建新群聊
 */
function createNewGroup() {
    const groupName = prompt('输入群聊名称:');
    if (!groupName) return;
    
    // 选择多个Agent
    const selectedAgents = [];
    chatState.agents.forEach(agent => {
        if (confirm(`是否添加 ${agent.name} 到群聊？`)) {
            selectedAgents.push(agent.name);
        }
    });
    
    if (selectedAgents.length === 0) {
        alert('至少选择一个Agent');
        return;
    }
    
    const group = {
        name: groupName,
        agents: selectedAgents,
        path: null,
        messages: [],
        speakMode: 'sequential' // sequential 或 random
    };
    
    chatState.groups.push(group);
    chatState.currentGroup = group;
    chatState.messages[groupName] = [];
    
    renderTopicsList();
    renderMessages();
}

/**
 * 加载话题
 */
async function loadTopic(topic) {
    chatState.currentTopic = topic;
    chatState.currentGroup = null;
    
    if (topic.path) {
        try {
            const content = await getFile(topic.path);
            const messages = parseMessagesFromContent(content);
            chatState.messages[topic.name] = messages;
        } catch (err) {
            console.error('加载话题失败:', err);
            chatState.messages[topic.name] = [];
        }
    } else {
        chatState.messages[topic.name] = [];
    }
    
    renderMessages();
}

/**
 * 加载群聊
 */
async function loadGroup(group) {
    chatState.currentGroup = group;
    chatState.currentTopic = null;
    
    if (group.path) {
        try {
            const content = await getFile(group.path);
            const messages = parseMessagesFromContent(content);
            chatState.messages[group.name] = messages;
        } catch (err) {
            console.error('加载群聊失败:', err);
            chatState.messages[group.name] = [];
        }
    } else {
        chatState.messages[group.name] = [];
    }
    
    renderMessages();
}

/**
 * 从内容解析消息
 */
function parseMessagesFromContent(content) {
    const messages = [];
    const lines = content.split('\n');
    
    // 这里需要根据消息格式解析
    // 格式：{（用户名）：消息}+时间戳；
    // 格式：{（Agent名）：消息}+时间戳；
    
    let currentMessage = null;
    
    for (const line of lines) {
        // 检测用户消息
        const userMatch = line.match(/\{（([^）]+)）：([^}]+)\}\+(\d+)/);
        if (userMatch) {
            if (currentMessage) messages.push(currentMessage);
            currentMessage = {
                type: 'user',
                sender: userMatch[1],
                content: userMatch[2],
                timestamp: parseInt(userMatch[3])
            };
            continue;
        }
        
        // 检测Agent消息
        const agentMatch = line.match(/\{（([^）]+)）：([^}]+)\}\+(\d+)/);
        if (agentMatch) {
            if (currentMessage) messages.push(currentMessage);
            currentMessage = {
                type: 'agent',
                sender: agentMatch[1],
                content: agentMatch[2],
                timestamp: parseInt(agentMatch[3])
            };
            continue;
        }
        
        // 检测事件
        const eventMatch = line.match(/\[([^\]]+)\]/);
        if (eventMatch) {
            if (currentMessage) messages.push(currentMessage);
            currentMessage = {
                type: 'event',
                title: eventMatch[1],
                content: line,
                timestamp: Date.now()
            };
            continue;
        }
        
        // 检测笔记
        const noteMatch = line.match(/\/\/([^:]+)：(.*)\/\/$/);
        if (noteMatch) {
            if (currentMessage) messages.push(currentMessage);
            currentMessage = {
                type: 'note',
                sender: noteMatch[1],
                content: noteMatch[2],
                timestamp: Date.now()
            };
            continue;
        }
        
        // 继续当前消息内容
        if (currentMessage) {
            currentMessage.content += '\n' + line;
        }
    }
    
    if (currentMessage) messages.push(currentMessage);
    
    return messages;
}

/**
 * 发送消息
 */
async function sendMessage() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    
    const content = input.value.trim();
    if (!content) return;
    
    // 清空输入框
    input.value = '';
    
    // 检测消息类型
    const detected = detectMessageType(content);
    
    // 创建用户消息
    const userMessage = {
        type: detected && detected.parsed ? (detected.type.name.includes('用户') ? 'user' : 'agent') : 'user',
        sender: detected && detected.parsed ? (detected.parsed.sender || '用户') : '用户',
        content: detected && detected.parsed ? detected.parsed.content : content,
        timestamp: detected && detected.parsed ? (detected.parsed.timestamp || Date.now()) : Date.now(),
        raw: content
    };
    
    // 添加到消息列表
    const currentName = chatState.currentTopic?.name || chatState.currentGroup?.name;
    if (!currentName) {
        alert('请先创建或选择话题/群聊');
        return;
    }
    
    if (!chatState.messages[currentName]) {
        chatState.messages[currentName] = [];
    }
    
    chatState.messages[currentName].push(userMessage);
    renderMessages();
    
    // 保存消息
    await saveMessage(userMessage, currentName);
    
    // 如果是话题，发送给Agent
    if (chatState.currentTopic) {
        await sendToAgent(content, chatState.currentTopic.agent);
    } else if (chatState.currentGroup) {
        // 群聊模式
        await sendToGroup(content, chatState.currentGroup);
    }
    
    // 保存话题和群聊列表
    localStorage.setItem('chatTopics', JSON.stringify(chatState.topics));
    localStorage.setItem('chatGroups', JSON.stringify(chatState.groups));
}

/**
 * 发送给Agent
 */
async function sendToAgent(userMessage, agentName) {
    const agent = getAgentConfig(agentName);
    if (!agent) return;
    
    // 构建提示词
    let prompt = agent.prompt || '';
    
    // 格式化Agent提示词（如果存在）
    if (prompt) {
        // 格式化提示词，去掉末尾多余的换行以便后续拼接
        const formattedPrompt = formatPromptContent(prompt, 'Agent提示词');
        prompt = formattedPrompt.trimEnd() + '\n';
    }
    
    // 添加可读取的视图内容
    if (agent.enabledViews && agent.enabledViews.length > 0) {
        for (const viewId of agent.enabledViews) {
            // 使用Map索引直接查找，O(1)复杂度
            const view = getViewById(viewId);
            if (view) {
                const viewContent = state.rawContents[viewId] || '';
                prompt += `\n视图 ${viewId} 的内容:\n${viewContent}\n`;
            }
        }
    }
    
    // 追加消息类型提示词（默认开启）
    prompt = appendMessageTypePrompts(prompt);
    
    // 调用AI API
    try {
        const response = await fetch(agent.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${agent.apiKey}`
            },
            body: JSON.stringify({
                model: agent.model,
                messages: [
                    { role: 'system', content: prompt },
                    { role: 'user', content: userMessage }
                ]
            })
        });
        
        const data = await response.json();
        const aiMessage = data.choices[0].message.content;
        
        // 检测AI回复的消息类型
        const aiDetected = detectMessageType(aiMessage);
        
        // 创建Agent消息
        const agentMessage = {
            type: 'agent',
            sender: agentName,
            content: aiDetected && aiDetected.parsed ? aiDetected.parsed.content : aiMessage,
            timestamp: aiDetected && aiDetected.parsed ? (aiDetected.parsed.timestamp || Date.now()) : Date.now(),
            raw: aiMessage
        };
        
        // 保存消息（多线程，不阻塞）
        const currentName = chatState.currentTopic?.name || chatState.currentGroup?.name;
        if (currentName) {
            saveMessage(agentMessage, currentName).catch(err => {
                console.error('保存消息失败:', err);
            });
            
            // 写入日志（多线程，不阻塞）
            writeLog(agentName, prompt, aiMessage).catch(err => {
                console.error('写入日志失败:', err);
            });
        }
    } catch (err) {
        console.error('发送消息失败:', err);
        alert('发送消息失败: ' + err.message);
    }
}

/**
 * 发送给群聊
 */
async function sendToGroup(userMessage, group) {
    if (group.speakMode === 'sequential') {
        // 顺序发言
        for (const agentName of group.agents) {
            await sendToAgent(userMessage, agentName);
            // 等待一段时间
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    } else {
        // 随机发言（根据当前时间决定）
        const now = Date.now();
        const index = now % group.agents.length;
        const agentName = group.agents[index];
        await sendToAgent(userMessage, agentName);
    }
}

/**
 * 保存消息（多线程，不阻塞）
 */
async function saveMessage(message, topicOrGroupName) {
    // 构建消息格式
    let messageText = '';
    
    // 使用消息类型检测来格式化消息
    const detected = detectMessageType(message.raw || message.content);
    
    if (detected && detected.type) {
        // 使用检测到的消息类型格式化
        const msgType = detected.type;
        if (message.type === 'user' || message.type === 'agent') {
            messageText = `${msgType.startSymbol}（${message.sender}）：${message.content}${msgType.endSymbol}+${message.timestamp}；\n`;
        } else if (message.type === 'event') {
            messageText = `${msgType.startSymbol}${message.title}${msgType.endSymbol}+（${message.content}）+{参与者：${message.participants?.join('、')}}+{发起者：${message.initiator}}\n`;
        } else if (message.type === 'note') {
            messageText = `${msgType.startSymbol}${message.sender}：${message.content}+事件的名[${message.eventTitle}]+${message.timestamp}${msgType.endSymbol}\n`;
        } else {
            // 默认格式
            messageText = `${msgType.startSymbol}${message.content}${msgType.endSymbol}+${message.timestamp}；\n`;
        }
    } else {
        // 如果没有检测到消息类型，使用默认格式
        if (message.type === 'user' || message.type === 'agent') {
            messageText = `{（${message.sender}）：${message.content}}+${message.timestamp}；\n`;
        } else if (message.type === 'event') {
            messageText = `[${message.title}]+（${message.content}）+{参与者：${message.participants?.join('、')}}+{发起者：${message.initiator}}\n`;
        } else if (message.type === 'note') {
            messageText = `//${message.sender}：${message.content}+事件的名[${message.eventTitle}]+${message.timestamp}//\n`;
        } else {
            messageText = `${message.content}+${message.timestamp}；\n`;
        }
    }
    
    // 确定保存路径（使用Agent的写入配置）
    const isGroup = chatState.currentGroup !== null;
    const agentName = isGroup ? 'group' : (chatState.currentTopic?.agent || 'unknown');
    const agent = getAgentConfig(agentName);
    
    let baseDir = `Message/${agentName}`;
    let fileName = `${topicOrGroupName}.md`;
    
    // 如果Agent配置了写入配置，使用配置的路径
    if (agent && agent.writeConfig) {
        const writeConfig = agent.writeConfig;
        if (writeConfig.saveDir) {
            baseDir = `Message/${agentName}/${writeConfig.saveDir}`;
        }
        
        // 使用命名规范
        if (writeConfig.namingRule) {
            const timestamp = Date.now();
            const date = new Date(timestamp);
            const dateStr = date.toISOString().split('T')[0];
            const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-');
            
            let naming = writeConfig.namingRule
                .replace(/{timestamp}/g, timestamp.toString())
                .replace(/{agentName}/g, agentName)
                .replace(/{date}/g, dateStr)
                .replace(/{time}/g, timeStr);
            
            if (writeConfig.prependFilename) {
                fileName = `${naming}_${topicOrGroupName}.md`;
            } else {
                fileName = `${naming}.md`;
            }
        }
    }
    
    const filePath = `${baseDir}/${fileName}`;
    
    // 使用多线程写入（不阻塞）
    writeMessageToFile(filePath, messageText, `${agentName}_message`).catch(err => {
        console.error(`保存消息失败 (${agentName}):`, err);
    });
}

/**
 * 多线程写入消息文件
 */
async function writeMessageToFile(filePath, content, agentName) {
    if (!writeQueues.has(agentName)) {
        writeQueues.set(agentName, { queue: [], isWriting: false });
    }
    
    const queue = writeQueues.get(agentName);
    queue.queue.push({ filePath, content });
    
    if (!queue.isWriting) {
        queue.isWriting = true;
        processWriteQueue(agentName);
    }
}

/**
 * 处理写入队列（Chat专用多线程写入）
 */
async function processWriteQueue(agentName) {
    const queue = writeQueues.get(agentName);
    
    while (queue.queue.length > 0) {
        const { filePath, content } = queue.queue.shift();
        
        try {
            // 读取现有内容
            let existingContent = '';
            try {
                existingContent = await getFile(filePath);
                // 如果返回的是错误JSON，说明文件不存在
                if (existingContent.trim().startsWith('{') && existingContent.includes('"error"')) {
                    existingContent = '';
                }
            } catch (err) {
                existingContent = '';
            }
            
            // 追加新内容
            const newContent = existingContent + content;
            
            // 写入文件（异步，不阻塞）
            await saveFile(filePath, newContent);
        } catch (err) {
            console.error(`写入消息文件失败 (${agentName}):`, err);
        }
        
        // 短暂延迟，避免过于频繁的写入
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    queue.isWriting = false;
}

/**
 * 写入日志
 */
async function writeLog(agentName, prompt, response) {
    const logDir = `log/${agentName}`;
    const timestamp = Date.now();
    const fileName = `${timestamp}_${agentName}_log.md`;
    const filePath = `${logDir}/${fileName}`;
    
    const logContent = `最后一步要发送给AI的拼接后的提示词：\n${prompt}\n\n${agentName}：${response}\n`;
    
    // 使用多线程写入
    await writeMessageToFile(filePath, logContent, `${agentName}_log`);
    
    // 更新日志面板（如果打开）
    updateLogPanel(agentName);
}

/**
 * 更新日志面板（实时显示）
 */
async function updateLogPanel(agentName) {
    const logPanel = document.getElementById('chat-log-panel');
    if (!logPanel || logPanel.style.display === 'none') return;
    
    // 查找最新的日志文件（根据时间戳）
    const logDir = `log/${agentName}`;
    let latestFile = null;
    let latestTimestamp = 0;
    
    // 从localStorage获取日志文件列表
    const logFilesKey = `chatLogFiles_${agentName}`;
    const savedFiles = localStorage.getItem(logFilesKey);
    
    if (savedFiles) {
        const files = JSON.parse(savedFiles)
            .filter(f => f.endsWith('.md') && f.includes('_log'));
        
        // 从文件名中提取时间戳，找到最新的
        files.forEach(file => {
            const match = file.match(/^(\d+)_/);
            if (match) {
                const timestamp = parseInt(match[1]);
                if (timestamp > latestTimestamp) {
                    latestTimestamp = timestamp;
                    latestFile = file;
                }
            }
        });
    }
    
    if (!latestFile) {
        const logContent = document.getElementById('chat-log-content');
        if (logContent) {
            logContent.textContent = '暂无日志文件';
        }
        return;
    }
    
    const filePath = `${logDir}/${latestFile}`;
    
    // 读取并显示
    try {
        const content = await getFile(filePath);
        const logContent = document.getElementById('chat-log-content');
        if (logContent) {
            logContent.textContent = content;
            // 滚动到底部
            logContent.scrollTop = logContent.scrollHeight;
        }
    } catch (err) {
        console.error('读取日志失败:', err);
        const logContent = document.getElementById('chat-log-content');
        if (logContent) {
            logContent.textContent = '读取日志失败: ' + err.message;
        }
    }
}

/**
 * 显示Agent日志面板
 */
export function showAgentLogPanel(agentName) {
    const panel = document.getElementById('chat-log-panel');
    if (!panel) return;
    
    panel.style.display = 'flex';
    chatState.currentLogAgent = agentName;
    renderLogList(agentName);
    updateLogPanel(agentName);
    
    // 开始实时更新
    if (chatState.logUpdateInterval) {
        clearInterval(chatState.logUpdateInterval);
    }
    chatState.logUpdateInterval = setInterval(() => {
        if (chatState.currentLogAgent) {
            updateLogPanel(chatState.currentLogAgent);
        }
    }, 1000); // 每秒更新一次
}

/**
 * 渲染日志列表
 */
async function renderLogList(agentName) {
    const list = document.getElementById('chat-log-list');
    if (!list) return;
    
    list.innerHTML = '';
    
    // 从localStorage获取日志文件列表
    const logFilesKey = `chatLogFiles_${agentName}`;
    const savedFiles = localStorage.getItem(logFilesKey);
    
    if (!savedFiles) {
        list.innerHTML = '<div style="color: var(--text-muted); padding: 10px; text-align: center;">暂无日志文件</div>';
        return;
    }
    
    const files = JSON.parse(savedFiles)
        .filter(f => f.endsWith('.md') && f.includes('_log'))
        .sort()
        .reverse(); // 最新的在前
    
    if (files.length === 0) {
        list.innerHTML = '<div style="color: var(--text-muted); padding: 10px; text-align: center;">暂无日志文件</div>';
        return;
    }
    
    files.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'panel-list-item';
        
        // 从文件名提取时间戳
        const match = file.match(/^(\d+)_/);
        const timestamp = match ? parseInt(match[1]) : 0;
        const date = new Date(timestamp);
        
        item.innerHTML = `
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">${date.toLocaleString('zh-CN')}</div>
            <div style="font-size: 13px; color: var(--text-primary);">${file}</div>
        `;
        
        item.addEventListener('click', async () => {
            const filePath = `log/${agentName}/${file}`;
            try {
                const content = await getFile(filePath);
                const logContent = document.getElementById('chat-log-content');
                if (logContent) {
                    logContent.textContent = content;
                }
            } catch (err) {
                console.error('读取日志失败:', err);
            }
        });
        
        list.appendChild(item);
    });
}

/**
 * 实时更新Chat消息显示（类似工作流日志的实时显示技术）
 */
function updateChatMessagesRealTime() {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;
    
    const currentName = chatState.currentTopic?.name || chatState.currentGroup?.name;
    if (!currentName || !chatState.messages[currentName]) return;
    
    // 检查是否有新消息需要实时显示
    const messages = chatState.messages[currentName];
    const currentDisplayCount = messagesContainer.children.length;
    
    if (messages.length > currentDisplayCount) {
        // 有新消息，只渲染新增的部分（增量更新，不重新渲染全部）
        for (let i = currentDisplayCount; i < messages.length; i++) {
            const msgEl = createMessageElement(messages[i]);
            messagesContainer.appendChild(msgEl);
        }
        
        // 滚动到底部（平滑滚动）
        setTimeout(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 10);
    }
}

/**
 * 渲染Agent配置（用于设置面板）
 */
function renderAgentConfig() {
    // 默认选择第一个Agent
    if (chatState.agents.length > 0) {
        selectAgentForEdit(chatState.agents[0].name);
    }
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.toggleChatPanel = toggleChatPanel;
    window.initChatManager = initChatManager;
    window.showMessageTypePanel = showMessageTypePanel;
    window.toggleMessageType = toggleMessageType;
    window.detectMessageType = detectMessageType;
    window.appendMessageTypePrompts = appendMessageTypePrompts;
}

