/**
 * DeepSeek 发送模块
 * 负责将内容发送到 DeepSeek AI
 */

import { state, getViewById } from '../core/state.js';
import { readCurrentView } from './editor.js';
import { formatPromptContent } from '../utils/promptFormatter.js';

/**
 * 发送内容到 DeepSeek
 * @param {string} content - 要发送的内容
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
export async function sendToDeepSeek(content) {
    if (!content || !content.trim()) {
        return { success: false, error: '内容不能为空' };
    }

    try {
        const response = await fetch('/api/deepseek/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prompt: content }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: '未知错误' }));
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const result = await response.json();
        return { success: true, message: result.message || '发送成功' };
    } catch (error) {
        console.error('发送到 DeepSeek 失败:', error);
        return { success: false, error: error.message || '发送失败' };
    }
}

/**
 * 获取所有视图内容（类似 copyContent 的逻辑）
 * @returns {Promise<string>}
 */
export async function getAllViewsContent() {
    if (!state.originalPath) {
        throw new Error('请先选择文件');
    }

    let text = '';

    // 添加全局提示词
    if (state.selectedPrompt && state.selectedPrompt.content) {
        text += formatPromptContent(state.selectedPrompt.content, '全局提示词');
    }

    // 添加所有视图内容
    state.views.forEach(view => {
        const content = state.rawContents[view.id] || '';
        const fileName = state.originalPath.split(/[/\\]/).pop();
        text += `${view.titleTemplate.replace('{filename}', fileName)}\n\n${content}\n\n\n`;
    });

    return text;
}

/**
 * 获取单个视图内容（包括视图的提示词）
 * @param {string} viewId - 视图ID
 * @returns {Promise<string>}
 */
export async function getSingleViewContent(viewId) {
    if (!state.originalPath) {
        throw new Error('请先选择文件');
    }

    try {
        // 使用 readCurrentView 获取视图内容和提示词
        const viewInfo = await readCurrentView(viewId);
        
        let text = '';

        // 添加视图的提示词（如果存在）
        if (viewInfo.prompt) {
            text += formatPromptContent(viewInfo.prompt, '视图提示词');
        }

        // 添加视图内容，使用Map索引直接查找，O(1)复杂度
        const view = getViewById(viewId);
        if (view) {
            const fileName = state.originalPath.split(/[/\\]/).pop();
            text += `${view.titleTemplate.replace('{filename}', fileName)}\n\n${viewInfo.content}\n\n\n`;
        }

        return text;
    } catch (error) {
        console.error('获取视图内容失败:', error);
        throw error;
    }
}

/**
 * 发送所有视图内容到 DeepSeek（快捷键 m）
 */
export async function sendAllViewsToDeepSeek() {
    try {
        const content = await getAllViewsContent();
        const result = await sendToDeepSeek(content);
        
        if (result.success) {
            // 显示成功反馈
            const btn = document.getElementById('btn-copy');
            if (btn) {
                const old = btn.innerText;
                btn.innerText = "✅ 已发送";
                setTimeout(() => btn.innerText = old, 1500);
            }
        } else {
            alert('发送失败: ' + (result.error || '未知错误'));
        }
    } catch (error) {
        console.error('发送所有视图失败:', error);
        alert('发送失败: ' + error.message);
    }
}

/**
 * 发送单个视图内容到 DeepSeek（快捷键 n 或按钮点击）
 * @param {string} viewId - 视图ID（如果为空，从导航栏获取当前选中的视图ID）
 */
export async function sendSingleViewToDeepSeek(viewId = null) {
    try {
        // 如果没有提供 viewId，从导航栏获取当前选中的视图ID
        if (!viewId) {
            const selectedRadio = document.querySelector('input[name="paste-target"]:checked');
            if (!selectedRadio) {
                alert('请先选择视图（在导航栏的 Ctrl+V 区域）');
                return;
            }
            viewId = selectedRadio.value;
        }

        const content = await getSingleViewContent(viewId);
        const result = await sendToDeepSeek(content);
        
        if (result.success) {
            // 使用统一的反馈管理
            const { showButtonSuccessFeedback } = await import('./viewManager.js');
            showButtonSuccessFeedback(`.view-send-deepseek-btn[data-view-id="${viewId}"]`);
        } else {
            alert('发送失败: ' + (result.error || '未知错误'));
        }
    } catch (error) {
        console.error('发送单个视图失败:', error);
        alert('发送失败: ' + error.message);
    }
}

