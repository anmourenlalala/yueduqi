/**
 * API模块
 * 负责与后端服务器通信
 */

/**
 * 获取目录内容
 */
export async function getDirectory(path) {
    const response = await fetch(`/api/directory?path=${encodeURIComponent(path)}`);
    if (!response.ok) {
        throw new Error(`Failed to get directory: ${response.status} ${response.statusText}`);
    }
    return await response.json();
}

/**
 * 获取文件内容
 */
export async function getFile(path) {
    try {
        const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
        if (!response.ok) {
            // 返回错误信息而不是抛出错误，避免影响工作流执行
            return `{"error": "File not found", "path": "${path}"}`;
        }
        return await response.text();
    } catch (error) {
        // 捕获网络错误等，返回错误信息而不是抛出错误
        console.warn(`获取文件失败: ${path}`, error);
        return `{"error": "File not found", "path": "${path}"}`;
    }
}

/**
 * 保存文件
 */
export async function saveFile(path, content) {
    const response = await fetch('/api/save-file', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path, content })
    });
    if (!response.ok) {
        throw new Error(`Failed to save file: ${response.status} ${response.statusText}`);
    }
    return await response.json();
}

/**
 * 创建新文件
 */
export async function createFile(path, content = '') {
    const response = await fetch('/api/new-file', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path, content })
    });
    if (!response.ok) {
        throw new Error(`Failed to create file: ${response.status} ${response.statusText}`);
    }
    return await response.json();
}

/**
 * 创建新文件夹
 */
export async function createFolder(path) {
    const response = await fetch('/api/new-folder', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path })
    });
    if (!response.ok) {
        throw new Error(`Failed to create folder: ${response.status} ${response.statusText}`);
    }
    return await response.json();
}

/**
 * 软删除文件或文件夹
 */
export async function softDelete(path) {
    const response = await fetch('/api/soft-delete', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path })
    });
    if (!response.ok) {
        throw new Error(`Failed to soft delete: ${response.status} ${response.statusText}`);
    }
    return await response.json();
}

/**
 * 恢复软删除的项目
 */
export async function restoreItem(path) {
    const response = await fetch('/api/restore-item', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path })
    });
    if (!response.ok) {
        throw new Error(`Failed to restore item: ${response.status} ${response.statusText}`);
    }
    return await response.json();
}

/**
 * 永久删除项目
 */
export async function permanentDelete(path) {
    const response = await fetch('/api/permanent-delete', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        credentials: 'same-origin',
        body: JSON.stringify({ path })
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: '删除失败' }));
        throw new Error(error.error || `Failed to permanent delete: ${response.status} ${response.statusText}`);
    }
    return await response.json();
}

/**
 * 获取回收站项目
 */
export async function getTrash() {
    const response = await fetch('/api/trash');
    if (!response.ok) {
        throw new Error(`Failed to get trash: ${response.status} ${response.statusText}`);
    }
    return await response.json();
}

// 视图配置 API
export async function getViewsConfig() {
    const response = await fetch('/api/views');
    if (!response.ok) throw new Error(`Failed to get views: ${response.status}`);
    return await response.json();
}

export async function saveViewsConfig(views, deletedViews = undefined) {
    const response = await fetch('/api/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ views, deletedViews })
    });
    if (!response.ok) throw new Error(`Failed to save views: ${response.status}`);
    return await response.json();
}

// 主题管理API
export async function getThemes() {
    const response = await fetch('/api/themes');
    if (!response.ok) throw new Error(`Failed to get themes: ${response.status}`);
    return await response.json();
}

export async function getTheme(name) {
    const response = await fetch(`/api/theme/${name}`);
    if (!response.ok) throw new Error(`Failed to get theme: ${response.status}`);
    return await response.json();
}

export async function saveTheme(name, css) {
    const response = await fetch('/api/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, css })
    });
    if (!response.ok) throw new Error(`Failed to save theme: ${response.status}`);
    return await response.json();
}

export async function deleteTheme(name) {
    const response = await fetch(`/api/theme/${name}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Failed to delete theme: ${response.status}`);
    return await response.json();
}

// 布局管理API
export async function getLayouts() {
    const response = await fetch('/api/layouts');
    if (!response.ok) throw new Error(`Failed to get layouts: ${response.status}`);
    return await response.json();
}

export async function getLayout(name) {
    const response = await fetch(`/api/layout/${name}`);
    if (!response.ok) throw new Error(`Failed to get layout: ${response.status}`);
    return await response.json();
}

export async function saveLayout(name, columns, fullscreenEnabled, fullscreenCloseOnEscape) {
    const response = await fetch('/api/layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, columns, fullscreenEnabled, fullscreenCloseOnEscape })
    });
    if (!response.ok) throw new Error(`Failed to save layout: ${response.status}`);
    return await response.json();
}

export async function deleteLayout(name) {
    const response = await fetch(`/api/layout/${name}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Failed to delete layout: ${response.status}`);
    return await response.json();
}

// HTML 页面布局管理 API
export async function getHtmlLayouts() {
    const response = await fetch('/api/html-layouts');
    if (!response.ok) throw new Error(`Failed to get html layouts: ${response.status}`);
    return await response.json();
}

export async function getHtmlLayout(name) {
    const response = await fetch(`/api/html-layout/${encodeURIComponent(name)}`);
    if (!response.ok) throw new Error(`Failed to get html layout: ${response.status}`);
    return await response.json();
}

export async function saveHtmlLayout(name, htmlTemplate, description = '', targetKey = 'main-layout') {
    const response = await fetch('/api/html-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, htmlTemplate, description, targetKey })
    });
    if (!response.ok) throw new Error(`Failed to save html layout: ${response.status}`);
    return await response.json();
}

export async function deleteHtmlLayout(name) {
    const response = await fetch(`/api/html-layout/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Failed to delete html layout: ${response.status}`);
    return await response.json();
}

// 提示词管理API
export async function getPrompts() {
    const response = await fetch('/api/prompts');
    if (!response.ok) throw new Error(`Failed to get prompts: ${response.status}`);
    return await response.json();
}

export async function getPrompt(name) {
    const response = await fetch(`/api/prompt/${name}`);
    if (!response.ok) throw new Error(`Failed to get prompt: ${response.status}`);
    return await response.json();
}

export async function savePrompt(name, content, enableWorkflowControl = false) {
    const response = await fetch('/api/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content, enableWorkflowControl })
    });
    if (!response.ok) throw new Error(`Failed to save prompt: ${response.status}`);
    return await response.json();
}

export async function deletePrompt(name) {
    const response = await fetch(`/api/prompt/${name}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Failed to delete prompt: ${response.status}`);
    return await response.json();
}

/**
 * 软删除提示词（重命名添加.deleted后缀）
 */
export async function softDeletePrompt(name) {
    const response = await fetch('/api/prompt/soft-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    if (!response.ok) throw new Error(`Failed to soft delete prompt: ${response.status}`);
    return await response.json();
}

// 工作流管理API
export async function getWorkflows() {
    const response = await fetch('/api/workflows');
    if (!response.ok) throw new Error(`Failed to get workflows: ${response.status}`);
    return await response.json();
}

export async function getWorkflow(name) {
    const response = await fetch(`/api/workflow/${name}`);
    if (!response.ok) throw new Error(`Failed to get workflow: ${response.status}`);
    return await response.json();
}

export async function saveWorkflow(name, content, description = '') {
    const response = await fetch('/api/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content, description })
    });
    if (!response.ok) throw new Error(`Failed to save workflow: ${response.status}`);
    return await response.json();
}

export async function deleteWorkflow(name) {
    const response = await fetch(`/api/workflow/${name}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Failed to delete workflow: ${response.status}`);
    return await response.json();
}

// 事件管理API
export async function getEvents() {
    const response = await fetch('/api/events');
    if (!response.ok) throw new Error(`Failed to get events: ${response.status}`);
    return await response.json();
}

export async function getEvent(name) {
    const response = await fetch(`/api/event/${name}`);
    if (!response.ok) throw new Error(`Failed to get event: ${response.status}`);
    return await response.json();
}

export async function saveEvent(name, workflowName, viewId, projectPath, promptId) {
    const body = {
        name,
        workflowName,
        viewId: viewId || null,
        projectPath: projectPath || null,
        promptId: promptId || null
    };
    const response = await fetch('/api/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`Failed to save event: ${response.status}`);
    return await response.json();
}

export async function deleteEvent(name) {
    const response = await fetch(`/api/event/${name}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Failed to delete event: ${response.status}`);
    return await response.json();
}
