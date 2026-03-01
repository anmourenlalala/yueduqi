/**
 * AI服务模块
 * 负责处理OpenAI API调用
 */

import { state } from '../core/state.js';
import { readCurrentView } from './editor.js';
import { formatPromptContent } from '../utils/promptFormatter.js';

/**
 * 获取所有当前视图的上下文信息
 * @returns {Promise<string>} 格式化的上下文字符串
 */
export async function getAllViewsContext() {
    // 原调试日志已关闭，如需排查上下文生成问题可临时打开
    // const callTime = new Date().toLocaleString('zh-CN');
    // console.log(`[getAllViewsContext] 函数被调用 - 时间: ${callTime}`);
    
    if (!state.originalPath) {
        // console.log(`[getAllViewsContext] 未打开文件，返回空上下文`);
        return '当前没有打开任何文件。';
    }
    
    if (!state.views || state.views.length === 0) {
        // console.log(`[getAllViewsContext] 未配置视图，返回空上下文`);
        return '当前没有配置任何视图。';
    }
    
    // 获取当前文件路径信息
    const lastSeparatorIndex = Math.max(state.originalPath.lastIndexOf('\\'), state.originalPath.lastIndexOf('/'));
    const fileName = lastSeparatorIndex >= 0 ? state.originalPath.substring(lastSeparatorIndex + 1) : state.originalPath;
    
    // console.log(`[getAllViewsContext] 开始收集上下文信息:`);
    // console.log(`  - 当前文件: ${fileName}`);
    // console.log(`  - 文件路径: ${state.originalPath}`);
    // console.log(`  - 视图数量: ${state.views.length}`);
    // console.log(`  - 全局提示词: ${state.selectedPrompt?.name || '无'}`);
    
    let context = `当前项目显示的文件内容：\n`;
    context += `共有 ${state.views.length} 个视图：\n\n`;
    context += `当前文件：${fileName}\n`;
    context += `文件路径：${state.originalPath}\n`;
    context += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    // 遍历所有视图，获取每个视图的内容
    const viewContents = [];
    for (let i = 0; i < state.views.length; i++) {
        const view = state.views[i];
        const viewId = view.id;
        
        try {
            // 获取视图信息
            const viewInfo = await readCurrentView(viewId);
            
            // 获取当前显示的文件路径
            const currentPath = state.panePaths[viewId] || '';
            const isShowingAi = state.viewAiStates[viewId] || false;
            
            const content = viewInfo.content || '';
            const contentLength = content.length;
            const isContentEmpty = !content.trim();
            
            // 记录每个视图的信息
            // console.log(`  - 视图 ${i + 1} [${viewId}]:`);
            // console.log(`    标题: ${view.titleTemplate.replace('{filename}', fileName)}`);
            // console.log(`    显示状态: ${isShowingAi ? 'AI视图' : '主视图'}`);
            // console.log(`    文件路径: ${currentPath || '未加载'}`);
            // console.log(`    内容长度: ${contentLength} 字符`);
            // console.log(`    内容是否为空: ${isContentEmpty ? '是' : '否'}`);
            
            viewContents.push({
                viewId,
                contentLength,
                isEmpty: isContentEmpty
            });
            
            context += `【视图 ${i + 1}：${viewId}】\n`;
            context += `标题：${view.titleTemplate.replace('{filename}', fileName)}\n`;
            context += `当前显示：${isShowingAi ? 'AI视图' : '主视图'}\n`;
            context += `文件路径：${currentPath || '未加载'}\n`;
            
            // 显示内容
            if (content.trim()) {
                // 限制内容长度，避免上下文过长
                const maxLength = 5000; // 每个视图最多5000字符
                const displayContent = content.length > maxLength 
                    ? content.substring(0, maxLength) + `\n...（内容已截断，共 ${content.length} 字符）`
                    : content;
                context += `内容：\n${displayContent}\n`;
            } else {
                context += `内容：空（文件未找到或为空）\n`;
            }
            
            context += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        } catch (error) {
            console.error(`  - 视图 ${i + 1} [${viewId}] 读取失败:`, error.message);
            context += `【视图 ${i + 1}：${viewId}】\n`;
            context += `错误：无法读取视图内容 - ${error.message}\n`;
            context += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        }
    }
    
    // 在所有视图内容之后，拼接全局提示词内容（只拼接一次）
    if (state.selectedPrompt && state.selectedPrompt.content) {
        context += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        context += formatPromptContent(state.selectedPrompt.content, '全局提示词');
    }
    
    // 记录最终结果
    const totalContextLength = context.length;
    const totalContentLength = viewContents.reduce((sum, v) => sum + v.contentLength, 0);
    const emptyViewsCount = viewContents.filter(v => v.isEmpty).length;
    const hasGlobalPrompt = state.selectedPrompt && state.selectedPrompt.content;
    
    // console.log(`[getAllViewsContext] 上下文收集完成:`);
    // console.log(`  - 总上下文长度: ${totalContextLength} 字符`);
    // console.log(`  - 总内容长度: ${totalContentLength} 字符`);
    // console.log(`  - 空视图数量: ${emptyViewsCount}`);
    // console.log(`  - 是否包含全局提示词: ${hasGlobalPrompt ? '是' : '否'}`);
    // if (hasGlobalPrompt) {
    //     console.log(`  - 全局提示词标题: ${state.selectedPrompt.name}`);
    //     console.log(`  - 全局提示词长度: ${state.selectedPrompt.content.length} 字符`);
    // }
    // console.log(`  - 完成时间: ${new Date().toLocaleString('zh-CN')}`);
    // console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    return context;
}

/**
 * 调用OpenAI API（带自动上下文）
 * @param {string} viewId - 视图ID
 * @param {string} messages - 消息内容（字符串或消息数组）
 * @param {object} options - 可选参数
 *   - includeContext: boolean - 是否自动包含所有视图的上下文（默认true）
 *   - temperature, max_tokens等 - 其他OpenAI参数
 * @returns {Promise<string>} AI回复内容
 */
export async function callOpenAIWithContext(viewId, messages, options = {}) {
    // 默认包含上下文
    const includeContext = options.includeContext !== false;
    
    // 如果不需要上下文，直接调用原函数
    if (!includeContext) {
        // 移除includeContext选项，避免传递给原函数
        const { includeContext: _, ...restOptions } = options;
        return callOpenAI(viewId, messages, restOptions);
    }
    
    // 获取所有视图的上下文
    const context = await getAllViewsContext();
    
    // 构建消息数组
    let messagesArray = [];
    if (typeof messages === 'string') {
        // 将上下文添加到用户消息前
        const fullMessage = `${context}\n\n用户消息：\n${messages}`;
        messagesArray = [
            {
                role: 'user',
                content: fullMessage
            }
        ];
    } else if (Array.isArray(messages)) {
        // 如果是消息数组，在第一条用户消息前添加上下文
        messagesArray = [...messages];
        // 查找第一条用户消息
        const firstUserIndex = messagesArray.findIndex(msg => msg.role === 'user');
        if (firstUserIndex >= 0) {
            // 在第一条用户消息前插入上下文消息
            messagesArray.splice(firstUserIndex, 0, {
                role: 'user',
                content: context
            });
        } else {
            // 如果没有用户消息，在开头添加
            messagesArray.unshift({
                role: 'user',
                content: context
            });
        }
    } else {
        throw new Error('消息格式错误，应为字符串或消息数组');
    }
    
    // 移除includeContext选项，避免传递给原函数
    const { includeContext: _, ...restOptions } = options;
    
    // 调用原函数
    return callOpenAI(viewId, messagesArray, restOptions);
}

/**
 * 调用OpenAI API
 * @param {string} viewId - 视图ID
 * @param {string} messages - 消息内容（字符串或消息数组）
 * @param {object} options - 可选参数（temperature, max_tokens等）
 * @returns {Promise<string>} AI回复内容
 */
export async function callOpenAI(viewId, messages, options = {}) {
    // 使用Map索引直接查找，O(1)复杂度
    const { getViewById } = await import('../core/state.js');
    const view = getViewById(viewId);
    if (!view || !view.openaiConfig) {
        throw new Error(`视图 ${viewId} 未配置OpenAI`);
    }
    
    const config = view.openaiConfig;
    if (!config.apiKey) {
        throw new Error(`视图 ${viewId} 未配置API Key`);
    }
    
    // 构建消息数组
    let messagesArray = [];
    if (typeof messages === 'string') {
        messagesArray = [
            {
                role: 'user',
                content: messages
            }
        ];
    } else if (Array.isArray(messages)) {
        messagesArray = messages;
    } else {
        throw new Error('消息格式错误，应为字符串或消息数组');
    }
    
    // 构建请求体
    const requestBody = {
        model: config.model || 'gpt-3.5-turbo',
        messages: messagesArray,
        temperature: options.temperature !== undefined ? options.temperature : 0.7,
        max_tokens: options.max_tokens !== undefined ? options.max_tokens : 2000,
        ...options
    };
    
    // 处理API URL：如果URL不包含/v1/chat/completions路径，自动添加
    let apiUrl = config.apiUrl.trim();
    // 移除末尾的斜杠
    if (apiUrl.endsWith('/')) {
        apiUrl = apiUrl.slice(0, -1);
    }
    
    // 解析URL，检查路径部分
    try {
        const urlObj = new URL(apiUrl);
        const pathname = urlObj.pathname;
        
        // 如果路径为空或只有/，或者路径是/v1，则添加完整路径
        if (!pathname || pathname === '/' || pathname === '/v1') {
            if (pathname === '/v1') {
                apiUrl = apiUrl + '/chat/completions';
            } else {
                apiUrl = apiUrl + '/v1/chat/completions';
            }
        }
        // 如果路径已经包含/v1/chat/completions，不做修改
        // 如果路径是其他值，也不做修改（让用户自己配置）
    } catch (e) {
        // 如果URL解析失败（可能是相对路径），检查字符串是否包含路径
        if (!apiUrl.includes('/v1/chat/completions')) {
            if (apiUrl.endsWith('/v1')) {
                apiUrl = apiUrl + '/chat/completions';
            } else {
                // 尝试提取路径部分（在端口号或域名之后的部分）
                const pathMatch = apiUrl.match(/:\d+(\/.*)?$/);
                if (!pathMatch || !pathMatch[1] || pathMatch[1] === '/') {
                    // 没有路径或只有/，添加完整路径
                    apiUrl = apiUrl + '/v1/chat/completions';
                }
            }
        }
    }
    
    try {
        // 添加调试日志
        console.log('发送AI请求:', {
            url: apiUrl,
            model: requestBody.model,
            messagesCount: messagesArray.length
        });
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify(requestBody)
        });
        
        console.log('收到AI响应:', {
            status: response.status,
            statusText: response.statusText,
            contentType: response.headers.get('content-type')
        });
        
        if (!response.ok) {
            // 先读取响应文本，判断是否为JSON
            const contentType = response.headers.get('content-type') || '';
            let errorData = {};
            let errorText = '';
            
            try {
                if (contentType.includes('application/json')) {
                    errorData = await response.json();
                } else {
                    errorText = await response.text();
                    // 尝试解析为JSON（某些API可能返回JSON但Content-Type不正确）
                    try {
                        errorData = JSON.parse(errorText);
                    } catch {
                        // 如果不是JSON，使用文本内容
                        errorData = { error: { message: errorText.substring(0, 200) } };
                    }
                }
            } catch (e) {
                errorText = await response.text().catch(() => '无法读取错误信息');
                errorData = { error: { message: errorText.substring(0, 200) } };
            }
            
            throw new Error(`OpenAI API错误: ${response.status} ${response.statusText} - ${errorData.error?.message || errorText || '未知错误'}`);
        }
        
        // 检查响应Content-Type，确保是JSON
        const contentType = response.headers.get('content-type') || '';
        let data;
        
        if (contentType.includes('application/json')) {
            data = await response.json();
        } else {
            // 如果不是JSON，尝试解析文本
            const text = await response.text();
            try {
                data = JSON.parse(text);
            } catch (e) {
                // 如果返回HTML，给出提示
                const isHtmlResponse = text.toLowerCase().includes('<!doctype') || text.toLowerCase().includes('<html');
                if (isHtmlResponse) {
                    throw new Error(`API返回了HTML页面而非JSON。\n实际请求URL: ${apiUrl}\n原始配置URL: ${config.apiUrl}\n响应状态: ${response.status} ${response.statusText}\n响应内容预览: ${text.substring(0, 300)}`);
                } else {
                    throw new Error(`API返回格式异常，期望JSON但收到: ${contentType}。响应内容: ${text.substring(0, 200)}`);
                }
            }
        }
        
        // 提取AI回复内容
        if (data.choices && data.choices.length > 0) {
            return data.choices[0].message.content;
        } else {
            throw new Error('API返回格式异常，未找到回复内容');
        }
    } catch (error) {
        console.error('OpenAI API调用失败:', error);
        // 如果错误信息中已经包含了详细说明，直接抛出
        if (error.message && (error.message.includes('API URL') || error.message.includes('配置'))) {
            throw error;
        }
        // 否则包装错误信息
        throw new Error(`AI调用失败: ${error.message}\n请检查视图 ${viewId} 的OpenAI配置（API Key、API URL、模型名）是否正确`);
    }
}

/**
 * 批量调用OpenAI（并发执行）
 * @param {Array<{viewId: string, messages: string|Array, options?: object}>} requests - 请求数组
 * @param {number} concurrency - 并发数量（默认3）
 * @returns {Promise<Array<{viewId: string, response: string, error?: Error}>>}
 */
export async function batchCallOpenAI(requests, concurrency = 3) {
    const results = [];
    const executing = [];
    
    for (const request of requests) {
        const promise = callOpenAI(request.viewId, request.messages, request.options || {})
            .then(response => {
                return { viewId: request.viewId, response, success: true };
            })
            .catch(error => {
                return { viewId: request.viewId, error, success: false };
            })
            .finally(() => {
                // 从执行队列中移除
                const index = executing.indexOf(promise);
                if (index > -1) {
                    executing.splice(index, 1);
                }
            });
        
        executing.push(promise);
        results.push(promise);
        
        // 如果达到并发限制，等待其中一个完成
        if (executing.length >= concurrency) {
            await Promise.race(executing);
        }
    }
    
    // 等待所有请求完成
    return Promise.all(results);
}

/**
 * 流式调用OpenAI（支持流式响应）
 * @param {string} viewId - 视图ID
 * @param {string} messages - 消息内容
 * @param {function} onChunk - 接收数据块的回调函数
 * @param {object} options - 可选参数
 * @returns {Promise<string>} 完整回复内容
 */
export async function streamOpenAI(viewId, messages, onChunk, options = {}) {
    // 使用Map索引直接查找，O(1)复杂度
    const { getViewById } = await import('../core/state.js');
    const view = getViewById(viewId);
    if (!view || !view.openaiConfig) {
        throw new Error(`视图 ${viewId} 未配置OpenAI`);
    }
    
    const config = view.openaiConfig;
    if (!config.apiKey) {
        throw new Error(`视图 ${viewId} 未配置API Key`);
    }
    
    if (!config.apiUrl) {
        throw new Error(`视图 ${viewId} 未配置API URL`);
    }
    
    // 构建消息数组
    let messagesArray = [];
    if (typeof messages === 'string') {
        messagesArray = [
            {
                role: 'user',
                content: messages
            }
        ];
    } else if (Array.isArray(messages)) {
        messagesArray = messages;
    } else {
        throw new Error('消息格式错误，应为字符串或消息数组');
    }
    
    // 构建请求体
    const requestBody = {
        model: config.model || 'gpt-3.5-turbo',
        messages: messagesArray,
        temperature: options.temperature !== undefined ? options.temperature : 0.7,
        max_tokens: options.max_tokens !== undefined ? options.max_tokens : 2000,
        stream: true,
        ...options
    };
    
    // 处理API URL：如果URL不包含/v1/chat/completions路径，自动添加
    let apiUrl = config.apiUrl.trim();
    // 移除末尾的斜杠
    if (apiUrl.endsWith('/')) {
        apiUrl = apiUrl.slice(0, -1);
    }
    
    // 解析URL，检查路径部分
    try {
        const urlObj = new URL(apiUrl);
        const pathname = urlObj.pathname;
        
        // 如果路径为空或只有/，或者路径是/v1，则添加完整路径
        if (!pathname || pathname === '/' || pathname === '/v1') {
            if (pathname === '/v1') {
                apiUrl = apiUrl + '/chat/completions';
            } else {
                apiUrl = apiUrl + '/v1/chat/completions';
            }
        }
        // 如果路径已经包含/v1/chat/completions，不做修改
        // 如果路径是其他值，也不做修改（让用户自己配置）
    } catch (e) {
        // 如果URL解析失败（可能是相对路径），检查字符串是否包含路径
        if (!apiUrl.includes('/v1/chat/completions')) {
            if (apiUrl.endsWith('/v1')) {
                apiUrl = apiUrl + '/chat/completions';
            } else if (!apiUrl.match(/\/[^\/]+\//)) {
                // 如果没有明显的路径（除了协议部分），添加完整路径
                apiUrl = apiUrl + '/v1/chat/completions';
            }
        }
    }
    
    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            // 先读取响应文本，判断是否为JSON
            const contentType = response.headers.get('content-type') || '';
            let errorData = {};
            let errorText = '';
            
            try {
                if (contentType.includes('application/json')) {
                    errorData = await response.json();
                } else {
                    errorText = await response.text();
                    // 尝试解析为JSON（某些API可能返回JSON但Content-Type不正确）
                    try {
                        errorData = JSON.parse(errorText);
                    } catch {
                        // 如果不是JSON，使用文本内容
                        errorData = { error: { message: errorText.substring(0, 200) } };
                    }
                }
            } catch (e) {
                errorText = await response.text().catch(() => '无法读取错误信息');
                errorData = { error: { message: errorText.substring(0, 200) } };
            }
            
            // 如果返回HTML，给出提示
            const isHtmlResponse = errorText.toLowerCase().includes('<!doctype') || errorText.toLowerCase().includes('<html');
            if (isHtmlResponse) {
                throw new Error(`API返回了HTML页面而非JSON。\n实际请求URL: ${apiUrl}\n原始配置URL: ${config.apiUrl}\n响应状态: ${response.status} ${response.statusText}\n响应内容预览: ${errorText.substring(0, 300)}`);
            }
            
            throw new Error(`OpenAI API错误: ${response.status} ${response.statusText} - ${errorData.error?.message || errorText || '未知错误'}`);
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(line => line.trim() !== '');
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') {
                        continue;
                    }
                    
                    try {
                        const json = JSON.parse(data);
                        if (json.choices && json.choices[0] && json.choices[0].delta) {
                            const content = json.choices[0].delta.content || '';
                            if (content) {
                                fullContent += content;
                                if (onChunk) {
                                    // 关键修复：直接同步调用onChunk，不要使用Promise包装
                                    // 这样多个步骤的chunk可以真正并发接收和处理，不会互相阻塞
                                    // onChunk内部会立即将chunk加入队列并标记需要更新，然后由全局渲染循环统一处理
                                    try {
                                        onChunk(content, fullContent);
                                    } catch (err) {
                                        console.error('onChunk回调执行失败:', err);
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        // 忽略JSON解析错误
                    }
                }
            }
        }
        
        return fullContent;
    } catch (error) {
        console.error('OpenAI流式API调用失败:', error);
        // 如果错误信息中已经包含了详细说明，直接抛出
        if (error.message && (error.message.includes('API URL') || error.message.includes('配置'))) {
            throw error;
        }
        // 否则包装错误信息
        throw new Error(`AI流式调用失败: ${error.message}\n请检查视图 ${viewId} 的OpenAI配置（API Key、API URL、模型名）是否正确`);
    }
}

/**
 * 流式调用OpenAI（带自动上下文）
 * @param {string} viewId - 视图ID
 * @param {string} messages - 消息内容
 * @param {function} onChunk - 接收数据块的回调函数
 * @param {object} options - 可选参数
 *   - includeContext: boolean - 是否自动包含所有视图的上下文（默认true）
 *   - temperature, max_tokens等 - 其他OpenAI参数
 * @returns {Promise<string>} 完整回复内容
 */
export async function streamOpenAIWithContext(viewId, messages, onChunk, options = {}) {
    // 默认包含上下文
    const includeContext = options.includeContext !== false;
    
    // 如果不需要上下文，直接调用原函数
    if (!includeContext) {
        // 移除includeContext选项，避免传递给原函数
        const { includeContext: _, ...restOptions } = options;
        return streamOpenAI(viewId, messages, onChunk, restOptions);
    }
    
    // 获取所有视图的上下文
    const context = await getAllViewsContext();
    
    // 构建消息数组
    let messagesArray = [];
    if (typeof messages === 'string') {
        // 将上下文添加到用户消息前
        const fullMessage = `${context}\n\n用户消息：\n${messages}`;
        messagesArray = [
            {
                role: 'user',
                content: fullMessage
            }
        ];
    } else if (Array.isArray(messages)) {
        // 如果是消息数组，在第一条用户消息前添加上下文
        messagesArray = [...messages];
        // 查找第一条用户消息
        const firstUserIndex = messagesArray.findIndex(msg => msg.role === 'user');
        if (firstUserIndex >= 0) {
            // 在第一条用户消息前插入上下文消息
            messagesArray.splice(firstUserIndex, 0, {
                role: 'user',
                content: context
            });
        } else {
            // 如果没有用户消息，在开头添加
            messagesArray.unshift({
                role: 'user',
                content: context
            });
        }
    } else {
        throw new Error('消息格式错误，应为字符串或消息数组');
    }
    
    // 移除includeContext选项，避免传递给原函数
    const { includeContext: _, ...restOptions } = options;
    
    // 调用原函数
    return streamOpenAI(viewId, messagesArray, onChunk, restOptions);
}

/**
 * 将上下文同步到后端服务器
 * @param {string} context - 上下文内容
 * @returns {Promise<boolean>} 是否同步成功
 */
async function syncContextToServer(context) {
    try {
        // 收集元数据：每个视图ID对应的文件名
        const viewFileMap = {}; // {viewId: fileName}
        
        if (state.views && state.panePaths) {
            state.views.forEach(view => {
                const viewId = view.id;
                const filePath = state.panePaths[viewId];
                
                if (filePath) {
                    // 从文件路径中提取文件名
                    const lastSeparatorIndex = Math.max(
                        filePath.lastIndexOf('\\'), 
                        filePath.lastIndexOf('/')
                    );
                    const fileName = lastSeparatorIndex >= 0 
                        ? filePath.substring(lastSeparatorIndex + 1) 
                        : filePath;
                    viewFileMap[viewId] = fileName;
                } else {
                    viewFileMap[viewId] = '未加载';
                }
            });
        }
        
        // 获取全局提示词标题
        const globalPromptName = state.selectedPrompt?.name || null;
        
        const metadata = {
            viewFileMap: viewFileMap, // {viewId: fileName}
            globalPromptName: globalPromptName // 全局提示词标题
        };
        
        const response = await fetch('http://localhost:2333/api/views/context', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                context,
                metadata 
            })
        });
        
        if (!response.ok) {
            throw new Error(`同步失败: ${response.status} ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log(`[syncContextToServer] 上下文已同步到服务器 - 长度: ${result.length} 字符`);
        console.log(`[syncContextToServer] 元数据: 视图文件映射=${JSON.stringify(viewFileMap)}, 全局提示词=${globalPromptName || '无'}`);
        return true;
    } catch (error) {
        console.error(`[syncContextToServer] 同步上下文到服务器失败:`, error.message);
        return false;
    }
}

/**
 * 自动同步上下文到服务器（在获取上下文时自动调用）
 */
let lastSyncedContext = null;
export async function getAllViewsContextWithSync() {
    const context = await getAllViewsContext();
    
    // 检查外部AI同步开关是否开启
    // 如果上下文有变化且外部AI同步已开启，同步到服务器
    if (context !== lastSyncedContext && state.externalAiSyncEnabled) {
        await syncContextToServer(context);
        lastSyncedContext = context;
    }
    
    return context;
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.callOpenAI = callOpenAI;
    window.batchCallOpenAI = batchCallOpenAI;
    window.streamOpenAI = streamOpenAI;
    window.getAllViewsContext = getAllViewsContext;
    window.getAllViewsContextWithSync = getAllViewsContextWithSync;
    window.callOpenAIWithContext = callOpenAIWithContext;
    window.streamOpenAIWithContext = streamOpenAIWithContext;
    window.syncContextToServer = syncContextToServer;
}

