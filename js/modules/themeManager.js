/**
 * 主题管理模块
 * 负责主题的加载、应用、编辑和保存
 */

import { state, saveStateToStorage } from '../core/state.js';
import { getThemes, getTheme, saveTheme as saveThemeAPI, deleteTheme } from '../core/api.js';
import { addToManagerHistory } from '../utils/managerHistory.js';

let currentEditingTheme = null;

/**
 * 加载主题列表
 */
export async function loadThemes() {
    try {
        const data = await getThemes();
        state.themes = data.themes || [];
        renderThemesList();
    } catch (err) {
        console.error('Failed to load themes:', err);
        state.themes = [];
    }
}

/**
 * 渲染主题列表
 */
export async function renderThemesList(searchTerm = '') {
    const list = document.getElementById('themes-list');
    if (!list) return;
    
    list.innerHTML = '';
    
    // 首先添加"无"选项（默认主题）
    const defaultItem = document.createElement('div');
    defaultItem.className = 'prompt-item';
    const isSelected = !state.selectedTheme || !state.selectedTheme.name;
    defaultItem.innerHTML = `
        <div class="file-item type-file ${isSelected ? 'selected' : ''}" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; margin-bottom: 6px; cursor: pointer; position: relative;" onclick="window.selectTheme('无')">
            <div style="flex: 1; min-width: 0; text-align: left;">
                <div class="theme-name-display" style="font-weight: bold; color: var(--accent-blue); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 60px;">无（默认）</div>
                <div style="font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-left: 2em;">&nbsp;&nbsp;使用系统默认主题</div>
            </div>
        </div>
    `;
    list.appendChild(defaultItem);
    
    const filteredThemes = state.themes.filter(theme =>
        !searchTerm || theme.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    if (filteredThemes.length === 0 && !searchTerm) {
        // 如果没有主题且没有搜索词，只显示"无"选项
        return;
    }
    
    if (filteredThemes.length === 0 && searchTerm) {
        list.innerHTML += '<div style="color: var(--text-muted); font-style: italic; padding: 10px;">没有找到匹配的主题</div>';
        return;
    }
    
    for (const theme of filteredThemes) {
        const isThemeSelected = state.selectedTheme && state.selectedTheme.name === theme.name;
        const item = document.createElement('div');
        item.className = 'prompt-item';
        item.innerHTML = `
            <div class="file-item type-file ${isThemeSelected ? 'selected' : ''}" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; margin-bottom: 6px; cursor: pointer; position: relative;" onclick="window.selectTheme('${theme.name}')">
                <div style="flex: 1; min-width: 0; text-align: left;">
                    <div class="theme-name-display" style="font-weight: bold; color: var(--accent-blue); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 60px;">${theme.name}</div>
                    <div style="font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-left: 2em;">&nbsp;&nbsp;${new Date(theme.updatedAt).toLocaleString()}</div>
                </div>
                <div style="display: flex; gap: 5px; position: absolute; right: 14px; transition: opacity 0.3s; opacity: 0;" class="theme-actions">
                    <button class="btn" onclick="event.stopPropagation(); window.editTheme('${theme.name}')" style="font-size: 12px; padding: 4px 8px;">编辑</button>
                    <button class="btn" onclick="event.stopPropagation(); window.removeTheme('${theme.name}')" style="font-size: 12px; padding: 4px 8px;">删除</button>
                </div>
            </div>
        `;
        list.appendChild(item);
        
        const themeItem = item.querySelector('.file-item');
        const actions = item.querySelector('.theme-actions');
        themeItem.addEventListener('mouseenter', () => actions.style.opacity = '1');
        themeItem.addEventListener('mouseleave', () => actions.style.opacity = '0');
    }
}

/**
 * 选择主题
 */
export async function selectTheme(name) {
    try {
        // 如果选择"无"主题，清除当前主题
        if (name === '无' || name === '默认' || !name) {
            clearTheme();
            const panel = document.getElementById('theme-panel');
            if (panel) panel.style.display = 'none';
            return;
        }
        
        // 先清除旧主题
        const existingStyles = document.querySelectorAll('#dynamic-theme-style, [data-theme-style]');
        existingStyles.forEach(el => el.remove());
        
        // 获取新主题
        const theme = await getTheme(name);
        state.selectedTheme = theme;
        
        // 处理不同格式的主题CSS
        const processedCSS = processThemeCSS(theme.css);
        applyThemeCSS(processedCSS);
        
        updateThemeDisplay();
        saveStateToStorage();
        
        const panel = document.getElementById('theme-panel');
        if (panel) panel.style.display = 'none';
    } catch (err) {
        console.error('Failed to select theme:', err);
        alert('加载主题失败: ' + err.message);
    }
}

/**
 * 从state应用主题（用于应用启动时恢复主题）
 */
export async function applyThemeFromState() {
    if (state.selectedTheme && state.selectedTheme.name) {
        try {
            // 重新从服务器获取最新主题
            const theme = await getTheme(state.selectedTheme.name);
            state.selectedTheme = theme;
            
            // 处理不同格式的主题CSS
            const processedCSS = processThemeCSS(theme.css);
            applyThemeCSS(processedCSS);
            updateThemeDisplay();
        } catch (err) {
            console.error('Failed to apply theme from state:', err);
            // 如果主题不存在，清除选择
            clearTheme();
        }
    } else {
        // 没有选中主题，显示"无"
        updateThemeDisplay();
    }
}

/**
 * 处理主题CSS，兼容多种格式
 * 只做必要的兼容性转换，保持CSS原样
 * 确保主题CSS能够覆盖默认样式
 */
function processThemeCSS(css) {
    if (!css) return '';
    
    // 如果CSS是字符串格式，只做必要的兼容性处理
    if (typeof css === 'string') {
        let processed = css;
        
        // 修复常见的注释格式错误：/* ... / 改为 /* ... */
        // 匹配以 /* 开头、以 / 结尾（但不是 */）的未闭合注释
        processed = processed.replace(/\/\*([^*]|\*(?!\/))*\s*\/\s*(?=\n|$)/gm, (match) => {
            // 如果注释以 / 结尾而不是 */，修复它
            if (match.endsWith('/') && !match.endsWith('*/')) {
                const fixed = match.replace(/\/(\s*(?:\n|$))$/, '*/$1');
                console.warn('[主题CSS] 修复未闭合的注释:', match.substring(0, 50) + '...');
                return fixed;
            }
            return match;
        });
        
        // 移除孤立的文本行（不在注释中的纯文本，如单独的 "text"）
        // 匹配独立的文本行（不是注释，不是CSS规则，不是空白）
        processed = processed.split('\n').map((line, index, lines) => {
            const trimmed = line.trim();
            // 跳过空行、注释行、CSS规则行
            if (!trimmed || 
                trimmed.startsWith('/*') || 
                trimmed.startsWith('*') ||
                trimmed.startsWith('//') ||
                trimmed.includes(':') ||
                trimmed.includes('{') ||
                trimmed.includes('}') ||
                trimmed.includes('--') ||
                trimmed.startsWith('#') ||
                trimmed.startsWith('@') ||
                /^[\d\s]+$/.test(trimmed)) {
                return line;
            }
            
            // 检查是否是CSS关键字或选择器
            const cssKeywords = ['root', 'var', 'rgba', 'linear-gradient', 'radial-gradient', 'calc', 'url', 'data-theme'];
            const isCSSKeyword = cssKeywords.some(kw => trimmed.includes(kw));
            
            // 如果看起来像纯文本（不是CSS关键字），移除它
            if (!isCSSKeyword && trimmed.length > 0 && trimmed.length < 50) {
                console.warn('[主题CSS] 检测到可能的孤立文本行，已移除:', trimmed);
                return '';
            }
            
            return line;
        }).join('\n');
        
        // 只处理 body.light-theme 和 body.dark-theme，转换为 data-theme 属性选择器
        // 这样用户的主题可以正确响应日间/夜间切换
        processed = processed.replace(/body\.light-theme\s*\{/g, '[data-theme="light"] body {');
        processed = processed.replace(/body\.dark-theme\s*\{/g, '[data-theme="dark"] body {');
        
        // 其他所有内容保持原样，不做任何修改
        // 用户的CSS会完全原样应用，包括：
        // - 所有自定义选择器（.sidebar, .main-chat, .bubble等）
        // - 所有自定义属性（--bg-gradient等）
        // - 所有动画、渐变、backdrop-filter等
        // - 所有注释和格式
        // - body选择器会直接应用到项目的body元素
        // - 所有CSS规则都会原样应用，能够覆盖默认样式
        
        return processed;
    }
    
    // 如果是对象格式，转换为CSS字符串
    if (typeof css === 'object') {
        return JSON.stringify(css);
    }
    
    return css;
}

/**
 * 提取默认CSS文件中定义的所有CSS变量名
 * 用于在应用主题前清除这些变量
 */
function extractDefaultCSSVariables() {
    const variables = new Set();
    
    // 从所有样式表中提取变量
    Array.from(document.styleSheets).forEach(sheet => {
        try {
            Array.from(sheet.cssRules || []).forEach(rule => {
                // 检查:root和[data-theme]选择器
                if (rule.selectorText === ':root' || 
                    rule.selectorText?.startsWith('[data-theme')) {
                    if (rule.style) {
                        Array.from(rule.style).forEach(prop => {
                            if (prop.startsWith('--')) {
                                variables.add(prop);
                            }
                        });
                    }
                }
            });
        } catch (e) {
            // 跨域样式表可能无法访问，忽略错误
        }
    });
    
    // 也尝试从themes.css文件中提取（如果可能）
    // 常见的默认变量名（作为后备）
    const commonVars = [
        '--bg-0', '--bg-1', '--bg-2', '--bg-3', '--bg-4',
        '--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-body', '--bg-pane',
        '--surface-0', '--surface-1', '--surface-2', '--surface-3',
        '--text-0', '--text-1', '--text-2', '--text-3', '--text-4',
        '--text-primary', '--text-secondary', '--text-muted',
        '--primary-400', '--primary-500', '--primary-600',
        '--accent-500', '--accent-600', '--accent-blue', '--accent-purple',
        '--border', '--border-light', '--border-subtle', '--border-base', 
        '--border-strong', '--border-emphasis',
        '--scrollbar-width', '--scrollbar-height', '--scrollbar-thumb-color',
        '--scrollbar-thumb-hover-color', '--scrollbar-track-color',
        '--scrollbar-thumb-gradient', '--scrollbar-thumb-hover-gradient',
        '--selection-bg-color', '--selection-text-color',
        '--font-ui', '--font-read', '--font-code',
        '--sidebar-width', '--font-size', '--border-radius', '--border-radius-lg'
    ];
    
    commonVars.forEach(v => variables.add(v));
    
    return Array.from(variables);
}

/**
 * 应用主题CSS
 * 完全原样应用用户提供的CSS，不做任何限制
 * 确保优先级最高，能够覆盖所有默认样式
 * 在应用前先清除默认主题的所有变量
 */
export function applyThemeCSS(css) {
    // 第一步：清除所有现有的主题样式
    const existingStyles = document.querySelectorAll('#dynamic-theme-style, #theme-reset-style, [data-theme-style], style[data-theme-style]');
    existingStyles.forEach(el => {
        if (el.id === 'dynamic-theme-style' || 
            el.id === 'theme-reset-style' || 
            el.getAttribute('data-theme-style')) {
            el.remove();
        }
    });
    
    if (!css || !css.trim()) {
        // 如果CSS为空，只清除旧样式，不应用新样式
        return;
    }
    
    // 第二步：清除默认主题的所有CSS变量
    // 通过创建一个重置样式，将所有默认CSS变量设置为未定义
    // 这样主题CSS中的变量就能完全覆盖默认变量
    const resetStyle = document.createElement('style');
    resetStyle.id = 'theme-reset-style';
    resetStyle.type = 'text/css';
    
    // 获取默认CSS文件中定义的所有变量名
    const defaultVariables = extractDefaultCSSVariables();
    
    // 创建重置CSS，将所有默认变量设置为未定义
    let resetCSS = '/* ==================== 清除默认主题变量 ==================== */\n';
    resetCSS += 'html:root, :root {\n';
    
    // 为所有默认变量设置未定义值（使用initial或unset）
    defaultVariables.forEach(varName => {
        resetCSS += `    ${varName}: unset;\n`;
    });
    
    resetCSS += '}\n';
    
    // 同样清除[data-theme]选择器中的变量
    resetCSS += 'html[data-theme="light"], [data-theme="light"] {\n';
    defaultVariables.forEach(varName => {
        resetCSS += `    ${varName}: unset;\n`;
    });
    resetCSS += '}\n';
    
    resetCSS += 'html[data-theme="dark"], [data-theme="dark"] {\n';
    defaultVariables.forEach(varName => {
        resetCSS += `    ${varName}: unset;\n`;
    });
    resetCSS += '}\n';
    
    resetStyle.textContent = resetCSS;
    
    // 第三步：应用用户提供的完整CSS（不做任何过滤，原样应用）
    const styleEl = document.createElement('style');
    styleEl.id = 'dynamic-theme-style';
    styleEl.setAttribute('data-theme-style', 'true');
    styleEl.type = 'text/css';
    
    // 智能解析CSS变量并自动应用body样式
    // 完全兼容任何CSS变量命名，不依赖特定变量名
    let finalCSS = css;
    
    // 检查是否包含body选择器（考虑各种可能的格式）
    const hasBodySelector = /body\s*\{/.test(css);
    
    // 如果定义了CSS变量但没有body选择器，智能解析并自动添加body样式
    if (!hasBodySelector && (css.includes(':root') || css.includes('[data-theme='))) {
        // 解析CSS中定义的所有变量
        const cssVariables = parseCSSVariables(css);
        
        if (cssVariables.length > 0) {
            // 智能匹配背景色和文字颜色变量
            const bgVar = findBestMatchVariable(cssVariables, ['bg', 'background'], ['body', '0', 'primary', 'main', 'base']);
            const textVar = findBestMatchVariable(cssVariables, ['text', 'color', 'font'], ['primary', '0', '1', 'main', 'body']);
            
            // 如果找到了匹配的变量，自动添加body选择器
            if (bgVar || textVar) {
                finalCSS += '\n\n/* ==================== 自动添加的body样式（确保主题生效） ==================== */\n';
                finalCSS += 'body {\n';
                
                if (bgVar) {
                    finalCSS += `    background-color: var(${bgVar}) !important;\n`;
                }
                
                if (textVar) {
                    finalCSS += `    color: var(${textVar}) !important;\n`;
                }
                
                finalCSS += '}\n';
                
                console.log('ℹ️ 检测到CSS变量但缺少body选择器，已自动添加body样式');
                if (bgVar) console.log(`  - 使用背景变量: ${bgVar}`);
                if (textVar) console.log(`  - 使用文字变量: ${textVar}`);
            }
        }
    }
    
    /**
     * 解析CSS中定义的所有变量
     * 支持:root和[data-theme]选择器，处理嵌套和复杂结构
     */
    function parseCSSVariables(cssText) {
        const variables = [];
        
        // 更健壮的CSS块解析：处理嵌套大括号
        function extractSelectorBlock(text, selectorPattern) {
            const blocks = [];
            const regex = new RegExp(selectorPattern, 'g');
            let match;
            
            while ((match = regex.exec(text)) !== null) {
                const startPos = match.index + match[0].length;
                let braceCount = 0;
                let inString = false;
                let stringChar = null;
                let blockStart = -1;
                
                // 找到匹配的开始大括号
                for (let i = startPos; i < text.length; i++) {
                    const char = text[i];
                    
                    // 处理字符串（避免在字符串内匹配大括号）
                    if ((char === '"' || char === "'") && (i === 0 || text[i - 1] !== '\\')) {
                        if (!inString) {
                            inString = true;
                            stringChar = char;
                        } else if (char === stringChar) {
                            inString = false;
                            stringChar = null;
                        }
                        continue;
                    }
                    
                    if (inString) continue;
                    
                    if (char === '{') {
                        if (braceCount === 0) {
                            blockStart = i + 1;
                        }
                        braceCount++;
                    } else if (char === '}') {
                        braceCount--;
                        if (braceCount === 0 && blockStart !== -1) {
                            const blockContent = text.substring(blockStart, i);
                            blocks.push(blockContent);
                            break;
                        }
                    }
                }
            }
            
            return blocks;
        }
        
        // 匹配:root选择器
        const rootBlocks = extractSelectorBlock(cssText, /:root\s*\{/);
        // 匹配[data-theme="..."]选择器
        const themeBlocks = extractSelectorBlock(cssText, /\[data-theme\s*=\s*["'][^"']*["']\]\s*\{/);
        
        // 合并所有块
        const allBlocks = [...rootBlocks, ...themeBlocks];
        
        // 从每个块中提取CSS变量
        allBlocks.forEach(blockContent => {
            // 匹配CSS变量定义: --variable-name: value;
            // 支持多行值和注释
            const varPattern = /--([\w-]+)\s*:\s*([^;]+?)(?=\s*;|\s*$)/g;
            let varMatch;
            
            while ((varMatch = varPattern.exec(blockContent)) !== null) {
                const varName = varMatch[1];
                let varValue = varMatch[2].trim();
                
                // 移除可能的注释
                varValue = varValue.replace(/\/\*[\s\S]*?\*\//g, '').trim();
                
                // 跳过空值
                if (varValue) {
                    variables.push({
                        name: varName,
                        fullName: `--${varName}`,
                        value: varValue
                    });
                }
            }
        });
        
        return variables;
    }
    
    /**
     * 智能匹配最合适的CSS变量
     * 完全通用，不依赖特定命名规范
     * @param {Array} variables - 所有解析出的CSS变量
     * @param {Array} keywords - 关键词列表（如['bg', 'background']）
     * @param {Array} prioritySuffixes - 优先级后缀列表（如['body', '0', 'primary']）
     * @returns {string|null} 匹配的变量名（带--前缀）或null
     */
    function findBestMatchVariable(variables, keywords, prioritySuffixes) {
        if (variables.length === 0) return null;
        
        // 按优先级排序：先匹配包含关键词和后缀的变量
        const scored = variables.map(v => {
            const nameLower = v.name.toLowerCase();
            let score = 0;
            
            // 检查是否包含关键词（支持部分匹配）
            const keywordMatches = keywords.filter(kw => {
                const kwLower = kw.toLowerCase();
                return nameLower.includes(kwLower) || 
                       nameLower.startsWith(kwLower) || 
                       nameLower.endsWith(kwLower);
            });
            
            if (keywordMatches.length === 0) return { var: v, score: 0 };
            
            // 关键词匹配度越高，基础分越高
            score += keywordMatches.length * 50;
            
            // 检查是否包含优先级后缀（精确匹配或作为单词的一部分）
            for (let i = 0; i < prioritySuffixes.length; i++) {
                const suffix = prioritySuffixes[i].toLowerCase();
                // 精确匹配
                if (nameLower === suffix) {
                    score = 2000 - i * 10; // 最高优先级
                    break;
                }
                // 作为后缀（如 --bg-body, --bg-0）
                if (nameLower.endsWith('-' + suffix)) {
                    score = 1500 - i * 10;
                    break;
                }
                // 作为前缀（如 --body-bg）
                if (nameLower.startsWith(suffix + '-')) {
                    score = 1400 - i * 10;
                    break;
                }
                // 包含在中间（如 --main-body-bg）
                if (nameLower.includes('-' + suffix + '-')) {
                    score = 1200 - i * 10;
                    break;
                }
            }
            
            // 如果没匹配到优先级后缀，但有关键词，给基础分
            if (score < 100) {
                score = 100 + keywordMatches.length * 10;
            }
            
            // 额外加分：变量名越短，通常优先级越高（如 --bg 比 --background-color 更可能被使用）
            if (v.name.length <= 10) {
                score += 20;
            }
            
            return { var: v, score };
        });
        
        // 过滤掉分数为0的，按分数排序
        const valid = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
        
        if (valid.length > 0) {
            return valid[0].var.fullName;
        }
        
        // 如果没有任何匹配，但有关键词相关的变量，返回第一个
        const keywordRelated = variables.filter(v => {
            const nameLower = v.name.toLowerCase();
            return keywords.some(kw => nameLower.includes(kw.toLowerCase()));
        });
        
        return keywordRelated.length > 0 ? keywordRelated[0].fullName : null;
    }
    
    // 第四步：增强CSS以确保所有内容都能生效
    // 完全原样应用整个CSS文件，包括所有选择器（:root, [data-theme], .message-bubble, button等）
    let enhancedCSS = finalCSS;
    
    // 只提高关键选择器（:root和[data-theme]）的特异性，确保覆盖默认CSS
    // 其他选择器保持原样，通过插入顺序和!important来确保优先级
    if (enhancedCSS.includes(':root')) {
        enhancedCSS = enhancedCSS.replace(/:root\s*\{/g, 'html:root, :root {');
    }
    
    if (enhancedCSS.includes('[data-theme')) {
        enhancedCSS = enhancedCSS.replace(/\[data-theme\s*=\s*["']([^"']+)["']\]\s*\{/g, 
            'html[data-theme="$1"], [data-theme="$1"] {');
    }
    
    // 对于其他选择器（如.message-bubble, button等），保持原样
    // 它们会通过插入顺序（在最后）来确保优先级
    // 如果用户需要更高优先级，可以在CSS中使用!important
    
    // 完全原样应用整个CSS文件（包括所有选择器和样式）
    // 用户的CSS会完全原样应用，包括：
    // - :root和[data-theme]中的CSS变量
    // - 所有自定义选择器（.message-bubble, .panel, .card, .sidebar-container等）
    // - 所有标签选择器（button, body等）
    // - 所有自定义属性、动画、渐变、backdrop-filter等
    // - 滚动条样式、选中文本样式等所有样式规则
    styleEl.textContent = enhancedCSS;
    
    // 第五步：按正确顺序插入样式
    // 1. 先插入重置样式（清除默认变量）
    document.head.appendChild(resetStyle);
    
    // 2. 再插入主题CSS（应用新样式）
    // 插入到head的绝对最后，确保优先级最高
    // 顺序：默认CSS < 重置样式 < 主题CSS
    document.head.appendChild(styleEl);
    
    // 4. 强制浏览器重新计算所有CSS变量
    // 通过触发DOM重排和重绘，确保所有使用var()的地方都获取新值
    if (document.body) {
        // 方法1：强制重新计算:root的样式
        const rootStyle = window.getComputedStyle(document.documentElement);
        void rootStyle.getPropertyValue('--bg-0'); // 触发计算
        
        // 方法2：强制所有元素重新计算样式
        requestAnimationFrame(() => {
            // 临时修改一个不影响显示的属性，触发重排
            const originalDisplay = document.body.style.display;
            document.body.style.display = 'none';
            void document.body.offsetHeight; // 触发重排
            document.body.style.display = originalDisplay;
            
            // 再次触发重排，确保所有CSS变量都被重新计算
            requestAnimationFrame(() => {
                void document.body.offsetHeight;
                
                // 遍历所有元素，强制重新计算样式（仅对可见元素）
                const allElements = document.querySelectorAll('*');
                const sampleSize = Math.min(100, allElements.length); // 只处理前100个元素，避免性能问题
                for (let i = 0; i < sampleSize; i++) {
                    const el = allElements[i];
                    if (el.offsetParent !== null) { // 只处理可见元素
                        void window.getComputedStyle(el).getPropertyValue('--bg-0');
                    }
                }
            });
        });
    }
    
    // 4. 强制浏览器重新计算样式优先级
    // 使用 requestAnimationFrame 确保 DOM 已完全加载后再触发重排
    requestAnimationFrame(() => {
        if (document.body) {
            const tempAttr = 'data-theme-applied';
            document.body.setAttribute(tempAttr, Date.now().toString());
            // 强制重排
            void document.body.offsetHeight;
            requestAnimationFrame(() => {
                document.body.removeAttribute(tempAttr);
                // 再次强制重排，确保样式生效
                void document.body.offsetHeight;
            });
        }
    });
    
    // 调试信息（默认关闭，如需排查主题问题可临时取消注释）
    // console.log('✅ 主题CSS已应用');
    // console.log('  - 长度:', css.length, '字符');
    // console.log('  - 样式元素位置:', Array.from(document.head.children).indexOf(styleEl));
    // console.log('  - CSS预览（前300字符）:', css.substring(0, 300));
    
    // 主题应用后，触发按钮字体大小调整
    if (typeof window !== 'undefined' && window.adjustHeaderButtonFontSizes) {
        setTimeout(() => {
            window.adjustHeaderButtonFontSizes();
        }, 200);
    }
    
    // 验证关键选择器是否存在
    const hasBody = css.includes('body');
    const hasRoot = css.includes(':root');
    const hasSidebar = css.includes('.sidebar');
    // console.log('  - 包含body选择器:', hasBody);
    // console.log('  - 包含:root选择器:', hasRoot);
    // console.log('  - 包含.sidebar选择器:', hasSidebar);
    
    // 强制浏览器重新计算样式
    if (document.body) {
        // 触发重排和重绘
        void document.body.offsetHeight;
        
        // 强制重新计算所有样式
        const allElements = document.querySelectorAll('*');
        if (allElements.length > 0) {
            void window.getComputedStyle(allElements[0]).display;
        }
    }
    
    // 验证样式是否已应用，并确保所有CSS变量都能动态生效
    setTimeout(() => {
        const appliedStyle = document.getElementById('dynamic-theme-style');
        if (appliedStyle) {
            console.log('✅ 主题CSS验证成功');
            
            const rootStyle = window.getComputedStyle(document.documentElement);
            
            // 从应用的CSS中提取所有定义的变量
            const cssText = appliedStyle.textContent;
            const varMatches = cssText.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g);
            const definedVars = Array.from(varMatches, m => ({
                name: `--${m[1]}`,
                rawValue: m[2].trim()
            }));
            
            let successCount = 0;
            let failCount = 0;
            
            if (definedVars.length > 0) {
                // 调试：如需细查变量应用情况，可打开下面这些日志
                /*
                console.log(`  - 检测到 ${definedVars.length} 个CSS变量定义`);
                console.log('  - CSS变量验证（前15个）:');
                
                definedVars.slice(0, 15).forEach(({ name, rawValue }) => {
                    const computedValue = rootStyle.getPropertyValue(name);
                    if (computedValue) {
                        console.log(`    ✅ ${name}: ${computedValue.trim()}`);
                        successCount++;
                    } else {
                        console.warn(`    ⚠️ ${name}: 未定义（原始值: ${rawValue}）`);
                        failCount++;
                    }
                });
                
                if (definedVars.length > 15) {
                    console.log(`    ... 还有 ${definedVars.length - 15} 个变量`);
                }
                */
                
                // 验证所有变量的应用情况
                const allVarsValid = definedVars.every(({ name }) => {
                    const value = rootStyle.getPropertyValue(name);
                    return value && value.trim() !== '';
                });
                
                if (allVarsValid) {
                    // console.log(`  ✅ 所有 ${definedVars.length} 个CSS变量都已成功应用`);
                } else {
                    console.warn(`  ⚠️ 有部分CSS变量未正确应用（成功: ${successCount}, 失败: ${failCount}）`);
                }
            }
            
            // 检查body的背景和颜色
            const bodyStyle = window.getComputedStyle(document.body);
            const bodyBg = bodyStyle.backgroundColor;
            const bodyColor = bodyStyle.color;
            
            // console.log('  - body样式检查:');
            // console.log(`    background: ${bodyBg}`);
            // console.log(`    color: ${bodyColor}`);
            
            // 检查一些关键元素是否使用了CSS变量
            const keySelectors = [
                { selector: '.header', name: '顶部标题栏' },
                { selector: '.sidebar', name: '侧边栏' },
                { selector: '.btn-primary', name: '主按钮' }
            ];
            
            keySelectors.forEach(({ selector, name }) => {
                const element = document.querySelector(selector);
                if (element) {
                    const elStyle = window.getComputedStyle(element);
                    const bg = elStyle.backgroundColor;
                    const color = elStyle.color;
                    // console.log(`  - ${name} (${selector}): bg=${bg}, color=${color}`);
                }
            });
            
            // 如果检测到变量未应用，尝试强制重新计算
            if (definedVars.length > 0 && failCount > 0) {
                console.warn('  ⚠️ 检测到部分变量未应用，强制重新计算所有CSS变量...');
                
                // 强制重新计算:root的所有变量
                document.documentElement.style.setProperty('--theme-refresh', Date.now().toString());
                void rootStyle.getPropertyValue('--theme-refresh');
                document.documentElement.style.removeProperty('--theme-refresh');
                
                // 再次验证
                setTimeout(() => {
                    const recheckVars = definedVars.slice(0, 10);
                    recheckVars.forEach(({ name }) => {
                        const value = rootStyle.getPropertyValue(name);
                        if (value && value.trim() !== '') {
                            console.log(`    ✅ ${name} 已重新应用: ${value.trim()}`);
                        }
                    });
                }, 50);
            }
        } else {
            console.error('❌ 主题CSS验证失败：样式元素不存在');
        }
    }, 150);
}

/**
 * 更新主题显示
 */
export function updateThemeDisplay() {
    const themeNameDisplay = document.getElementById('current-theme-name');
    if (themeNameDisplay) {
        if (state.selectedTheme && state.selectedTheme.name) {
            themeNameDisplay.textContent = state.selectedTheme.name;
        } else {
            themeNameDisplay.textContent = '无';
        }
    }
}

/**
 * 清空主题
 */
export function clearTheme() {
    state.selectedTheme = null;
    localStorage.removeItem('selectedTheme');
    
    // 移除所有主题样式
    const existingStyles = document.querySelectorAll('#dynamic-theme-style, [data-theme-style]');
    existingStyles.forEach(el => el.remove());
    
    // 移除body上的主题类
    document.body.classList.remove('light-theme', 'dark-theme');
    
    updateThemeDisplay();
    saveStateToStorage();
}

/**
 * 切换主题模式（日间/夜间）
 */
export function toggleThemeMode() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    // 更新所有主题切换按钮的图标和提示
    ['toggle-theme-mode-btn', 'toggle-theme-mode-btn-header'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.textContent = '🌓';
            btn.title = newTheme === 'light' ? '切换到夜间主题' : '切换到日间主题';
        }
    });

    // 通知所有分离窗口同步主题模式
    try {
        // 动态导入，避免循环依赖问题
        import('./dragSeparator/index.js').then(mod => {
            if (mod && typeof mod.broadcastThemeModeChange === 'function') {
                mod.broadcastThemeModeChange(newTheme);
            }
        }).catch(err => {
            console.warn('[主题] 向分离窗口广播主题模式失败:', err);
        });
    } catch (e) {
        console.warn('[主题] 调用主题广播时出错:', e);
    }
    
    // 强制浏览器重新计算所有CSS变量，确保动态创建的元素也能正确更新
    // 通过触发DOM重排和重绘，确保所有使用var()的地方都获取新值
    requestAnimationFrame(() => {
        // 强制重新计算:root的样式
        const rootStyle = window.getComputedStyle(document.documentElement);
        void rootStyle.getPropertyValue('--success'); // 触发计算
        void rootStyle.getPropertyValue('--inverse-text'); // 触发计算
        void rootStyle.getPropertyValue('--surface-0'); // 触发计算
        
        // 强制所有使用CSS变量的元素重新计算样式
        requestAnimationFrame(() => {
            // 临时修改一个不影响显示的属性，触发重排
            const originalDisplay = document.body.style.display;
            document.body.style.display = 'none';
            void document.body.offsetHeight; // 触发重排
            document.body.style.display = originalDisplay;
            
            // 再次触发重排，确保所有CSS变量都被重新计算
            requestAnimationFrame(() => {
                void document.body.offsetHeight;
                
                // 遍历所有反馈标签元素，强制重新计算样式
                const feedbackTags = document.querySelectorAll('.feedback-type-tag');
                feedbackTags.forEach(tag => {
                    void window.getComputedStyle(tag).getPropertyValue('background');
                    void window.getComputedStyle(tag).getPropertyValue('color');
                });
            });
        });
    });
}

/**
 * 新建主题
 */
export function newTheme() {
    const nameInput = document.getElementById('theme-name');
    const contentInput = document.getElementById('theme-content');
    const cancelBtn = document.getElementById('cancel-theme-edit');
    
    if (nameInput) nameInput.value = '';
    if (contentInput) contentInput.value = '';
    if (cancelBtn) cancelBtn.style.display = 'none';
    currentEditingTheme = null;
    if (nameInput) nameInput.focus();
}

/**
 * 保存主题
 */
export async function saveTheme() {
    const nameInput = document.getElementById('theme-name');
    const contentInput = document.getElementById('theme-content');
    
    if (!nameInput || !contentInput) return false;
    
    const name = nameInput.value.trim();
    const css = contentInput.value.trim();
    
    if (!name || !css) {
        alert('请填写名称和CSS内容');
        return false;
    }
    
    // 保存前记录当前状态到历史
    addToManagerHistory('theme', {
        name: nameInput.value,
        css: contentInput.value
    });
    
    try {
        const data = await saveThemeAPI(name, css);
        await loadThemes();
        
        // 如果保存的是当前选中的主题，立即应用更新后的主题
        if (state.selectedTheme && state.selectedTheme.name === name) {
            // 处理不同格式的主题CSS
            const processedCSS = processThemeCSS(css);
            state.selectedTheme = { name, css };
            applyThemeCSS(processedCSS);
            updateThemeDisplay();
            saveStateToStorage();
        }
        
        resetThemeForm();
        
        const saveBtn = document.getElementById('save-theme');
        if (saveBtn) {
            const originalText = saveBtn.textContent;
            saveBtn.textContent = currentEditingTheme ? '✅ 已更新' : '✅ 已保存';
            setTimeout(() => {
                saveBtn.textContent = originalText;
            }, 1500);
        }
        
        return true;
    } catch (err) {
        alert('保存失败: ' + err.message);
        return false;
    }
}

/**
 * 重置主题表单
 */
export function resetThemeForm() {
    const nameInput = document.getElementById('theme-name');
    const contentInput = document.getElementById('theme-content');
    const cancelBtn = document.getElementById('cancel-theme-edit');
    
    if (nameInput) nameInput.value = '';
    if (contentInput) contentInput.value = '';
    if (cancelBtn) cancelBtn.style.display = 'none';
    currentEditingTheme = null;
}

/**
 * 编辑主题
 */
export async function editTheme(name) {
    try {
        const theme = await getTheme(name);
        
        const nameInput = document.getElementById('theme-name');
        const contentInput = document.getElementById('theme-content');
        const cancelBtn = document.getElementById('cancel-theme-edit');
        
        if (nameInput) nameInput.value = theme.name;
        if (contentInput) contentInput.value = theme.css;
        if (cancelBtn) cancelBtn.style.display = 'inline-block';
        
        currentEditingTheme = theme.name;
        
        if (nameInput) {
            nameInput.scrollIntoView({ behavior: 'smooth' });
        }
    } catch (err) {
        alert('加载主题失败: ' + err.message);
    }
}

/**
 * 删除主题
 */
export async function removeTheme(name) {
    if (!confirm(`确定要删除主题 "${name}" 吗？`)) return;
    
    try {
        await deleteTheme(name);
        
        if (state.selectedTheme && state.selectedTheme.name === name) {
            state.selectedTheme = null;
            const styleEl = document.getElementById('dynamic-theme-style');
            if (styleEl) styleEl.remove();
            updateThemeDisplay();
        }
        
        await loadThemes();
    } catch (err) {
        alert('删除失败: ' + err.message);
    }
}

/**
 * 导入主题
 */
export function importTheme() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (!data.name || !data.css) {
                alert('无效的主题文件格式');
                return;
            }
            
            const nameInput = document.getElementById('theme-name');
            const contentInput = document.getElementById('theme-content');
            
            if (nameInput) nameInput.value = data.name;
            if (contentInput) contentInput.value = data.css;
            currentEditingTheme = null;
        } catch (err) {
            alert('导入失败: ' + err.message);
        }
    };
    input.click();
}

/**
 * 导出主题
 */
export async function exportTheme() {
    const nameInput = document.getElementById('theme-name');
    if (!nameInput) return;
    
    const name = nameInput.value.trim();
    if (!name) {
        alert('请先输入主题名称');
        return;
    }
    
    try {
        const theme = await getTheme(name);
        
        const dataStr = JSON.stringify(theme, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name}.json`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        alert('导出失败: ' + err.message);
    }
}

/**
 * 预览主题
 */
export function previewTheme() {
    const contentInput = document.getElementById('theme-content');
    if (!contentInput) return;
    
    const css = contentInput.value;
    if (!css.trim()) {
        alert('请先输入CSS内容');
        return;
    }
    
    // 处理不同格式的主题CSS
    const processedCSS = processThemeCSS(css);
    applyThemeCSS(processedCSS);
    
    setTimeout(() => {
        alert('预览已应用，如果满意请保存');
    }, 100);
}

/**
 * 格式化CSS
 */
export function formatThemeCSS() {
    const contentInput = document.getElementById('theme-content');
    if (!contentInput) return;
    
    const css = contentInput.value;
    let formatted = css
        .replace(/\s*\{\s*/g, ' {\n    ')
        .replace(/\s*\}\s*/g, '\n}\n')
        .replace(/\s*;\s*/g, ';\n    ')
        .replace(/\n\s*\n/g, '\n');
    contentInput.value = formatted;
}

/**
 * 显示主题模板
 */
export function showThemeTemplate() {
    const panel = document.getElementById('theme-template-panel');
    const content = document.getElementById('theme-template-content');
    
    if (!panel || !content) return;
    
    const template = `/* ==================== 主题模板 ==================== */
/* 包含日间和夜间两种模式，根据 data-theme 属性切换 */
/* 注意：此模板包含所有必要的CSS变量，修改后需要保存并应用主题才能看到效果 */

/* ==================== ⚠️ 语法要求（重要） ⚠️ ==================== */
/* 
 * 1. 所有注释必须使用标准格式：/* ... */（开头和结尾都要有 * 和 /）
 * 2. 不要在 CSS 代码块中插入纯文本（如单独的 "text" 行），所有说明都写在注释里
 * 3. 每个 CSS 变量声明必须以分号结尾：--variable-name: value;
 * 4. :root 和 [data-theme="light"] 块必须完整，不能缺少大括号
 * 5. 颜色值可以使用：十六进制（#rrggbb）、rgba()、var() 引用其他变量
 */

/* ==================== ⚠️ 重要提示：必须修改背景颜色 ⚠️ ==================== */
/* 
 * 🔴 背景颜色变量（必须修改）：
 * 这些变量控制整个应用的背景颜色，是主题的核心！
 * 请根据你的设计需求修改以下变量：
 * 
 * --bg-0 到 --bg-4: 基础背景色层次（从最深到最浅）
 * --surface-0 到 --surface-3: 表面颜色（用于卡片、面板、按钮等）
 * 
 * 建议：保持层次感，确保文字可读性
 */

/* ==================== 🎨 渐变色使用指南 ==================== */
/* 
 * 如果你想使用渐变色来美化主题，可以按照以下方式设置：
 * 
 * 1. 背景渐变（用于页面背景、卡片背景等）：
 *    格式：linear-gradient(角度, 颜色1 位置%, 颜色2 位置%, ...)
 *    示例：
 *    --bg-gradient-0: linear-gradient(135deg, #0a0a0a 0%, #1a0a0a 50%, #2a0a0a 100%);
 *    --surface-gradient-0: linear-gradient(145deg, #2a0a0a 0%, #3a0a0a 100%);
 * 
 *    常用角度：
 *    - 0deg: 从左到右
 *    - 90deg: 从下到上
 *    - 135deg: 从左上到右下（推荐，视觉效果较好）
 *    - 180deg: 从右到左
 *    - 270deg: 从上到下
 * 
 * 2. 滚动条渐变（用于美化滚动条）：
 *    必须同时设置以下变量：
 *    --scrollbar-thumb-gradient: 滚动条滑块默认渐变
 *    --scrollbar-thumb-hover-gradient: 滚动条滑块悬停渐变
 *    --scrollbar-thumb-color: 滚动条滑块纯色（Firefox fallback）
 *    --scrollbar-thumb-hover-color: 滚动条滑块悬停纯色（Firefox fallback）
 * 
 *    示例：
 *    --scrollbar-thumb-gradient: linear-gradient(135deg, var(--primary-400) 0%, var(--accent-500) 100%);
 *    --scrollbar-thumb-hover-gradient: linear-gradient(135deg, var(--primary-500) 0%, var(--accent-600) 100%);
 *    --scrollbar-thumb-color: var(--primary-400);  /* Firefox 使用纯色 */
 *    --scrollbar-thumb-hover-color: var(--primary-500);  /* Firefox 使用纯色 */
 * 
 *    注意：
 *    - Chrome/Edge/Safari 等 WebKit 浏览器会显示渐变效果
 *    - Firefox 不支持渐变，会自动使用 --scrollbar-thumb-color 纯色
 *    - 必须同时设置渐变和纯色变量，确保所有浏览器都能正常显示
 * 
 * 3. 主色调渐变（用于按钮、链接等强调元素）：
 *    --primary-gradient: linear-gradient(135deg, #ff5733 0%, #ff8a00 50%, #ffa500 100%);
 *    --primary-gradient-hover: linear-gradient(135deg, #ff8a00 0%, #ffa500 50%, #ffc107 100%);
 *    --accent-gradient: linear-gradient(135deg, #ff3333 0%, #ff5555 50%, #ff7777 100%);
 * 
 * 4. 边框渐变（用于特殊边框效果）：
 *    --border-base: linear-gradient(90deg, rgba(255, 87, 51, 0.4), rgba(255, 138, 0, 0.4));
 *    --border-strong: linear-gradient(90deg, rgba(255, 87, 51, 0.6), rgba(255, 138, 0, 0.6));
 * 
 * 5. 文字渐变（用于标题、强调文字）：
 *    在CSS中使用：
 *    background: var(--primary-gradient);
 *    -webkit-background-clip: text;
 *    -webkit-text-fill-color: transparent;
 *    background-clip: text;
 * 
 * ⚠️ 重要提示：
 * - 渐变变量中可以使用 var() 引用其他颜色变量
 * - 渐变变量中可以使用 rgba() 设置透明度
 * - 如果使用渐变，建议同时提供纯色 fallback（用于不支持渐变的元素）
 * - 滚动条渐变必须同时设置纯色变量，确保 Firefox 兼容性
 * - 渐变角度建议使用 135deg（从左上到右下），视觉效果最佳
 * 
 * 💡 渐变色搭配建议：
 * - 使用相邻色相（如红→橙→黄）创建温暖渐变
 * - 使用互补色（如蓝→紫）创建对比渐变
 * - 使用同色系不同明度（如深蓝→浅蓝）创建柔和渐变
 * - 避免使用过多颜色停止点（建议 2-3 个），保持简洁
 */

/* ==================== 夜间模式（默认） ==================== */
:root {
    /* ==================== 🔴 背景颜色（必须修改） ==================== */
    /* 基础背景色 - 从深到浅的层次（控制整个应用的背景） */
    --bg-0: #0a0e1a;  /* 🔴 最深层背景（页面主背景） */
    --bg-1: #0f1626;  /* 🔴 主背景 */
    --bg-2: #1a2235;  /* 🔴 次要背景 */
    --bg-3: #252f47;  /* 🔴 三级背景 */
    --bg-4: #2f3b58;  /* 🔴 四级背景 */
    
    /* 表面颜色 - 用于卡片、面板、按钮等（控制所有可交互元素的背景） */
    --surface-0: #1a2235;  /* 🔴 表面0（最浅） */
    --surface-1: #252f47;  /* 🔴 表面1 */
    --surface-2: #2f3b58;  /* 🔴 表面2（按钮默认背景） */
    --surface-3: #394869;  /* 🔴 表面3（按钮hover背景） */
    
    /* 边框颜色 */
    --border-subtle: rgba(255, 255, 255, 0.05);
    --border-base: rgba(255, 255, 255, 0.1);
    --border-strong: rgba(255, 255, 255, 0.15);
    --border-emphasis: rgba(255, 255, 255, 0.2);
    
    /* 文字颜色 - 从浅到深的层次 */
    --text-0: #ffffff;
    --text-1: #e8edf7;
    --text-2: #c4cee0;
    --text-3: #9ba8c2;
    --text-4: #7281a3;
    
    /* 主色调 - 蓝色系 */
    --primary-400: #4d9eff;
    --primary-500: #5db8ff;
    --primary-600: #6dc8ff;
    
    /* 强调色 - 紫色系 */
    --accent-500: #7a6dff;
    --accent-600: #8d7aff;
    
    /* 状态颜色 */
    --success: #4ade80;
    --warning: #fbbf24;
    --error: #f87171;
    --info: #60a5fa;
    
    /* 兼容旧变量 */
    --bg-primary: var(--bg-1);
    --bg-secondary: var(--bg-2);
    --bg-tertiary: var(--bg-3);
    --bg-body: var(--bg-0);
    --bg-pane: var(--surface-0);
    --text-primary: var(--text-1);
    --text-secondary: var(--text-2);
    --text-muted: var(--text-3);
    --accent-blue: var(--primary-400);
    --accent-purple: var(--accent-500);
    --border: var(--border-base);
    --border-light: var(--border-subtle);
    --accent-bg: rgba(77, 158, 255, 0.08);
    --code-bg: rgba(30, 38, 64, 0.7);
    
    /* 界面尺寸 */
    --sidebar-width: 220px;
    --font-size: 15px;
    --border-radius: 8px;
    --border-radius-lg: 12px;
    
    /* 字体 */
    --font-ui: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --font-read: 'Inter', 'Microsoft YaHei', sans-serif;
    --font-code: 'JetBrains Mono', Consolas, monospace;
    
    /* ==================== 🎨 滚动条样式（支持渐变色） ==================== */
    /* 滚动条尺寸 */
    --scrollbar-width: 10px;
    --scrollbar-height: 10px;
    --scrollbar-thumb-radius: 5px;
    --scrollbar-track-radius: 5px;
    
    /* 滚动条颜色（纯色，用于 Firefox 和 fallback） */
    --scrollbar-thumb-color: var(--primary-400);
    --scrollbar-thumb-hover-color: var(--primary-500);
    --scrollbar-track-color: var(--surface-2);
    
    /* 滚动条透明度 */
    --scrollbar-thumb-opacity: 0.8;
    --scrollbar-thumb-hover-opacity: 1;
    --scrollbar-track-opacity: 0.2;
    
    /* 滚动条阴影效果 */
    --scrollbar-thumb-shadow: 0 2px 8px rgba(77, 158, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15);
    --scrollbar-thumb-hover-shadow: 0 4px 16px rgba(77, 158, 255, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.2);
    
    /* 🎨 滚动条渐变（WebKit 浏览器会显示渐变，Firefox 使用上面的纯色） */
    /* 格式：linear-gradient(角度, 颜色1 位置%, 颜色2 位置%) */
    /* 示例：linear-gradient(135deg, #ff5733 0%, #ff8a00 50%, #ffa500 100%) */
    --scrollbar-thumb-gradient: linear-gradient(135deg, var(--primary-400) 0%, var(--accent-500) 100%);
    --scrollbar-thumb-hover-gradient: linear-gradient(135deg, var(--primary-500) 0%, var(--accent-600) 100%);
    
    /* 💡 渐变色设置提示：
     * 1. 必须同时设置 --scrollbar-thumb-color 和 --scrollbar-thumb-gradient
     *    原因：Firefox 不支持渐变，会自动使用纯色变量
     * 2. 渐变角度建议使用 135deg（从左上到右下），视觉效果最佳
     * 3. 可以在渐变中使用 var() 引用其他颜色变量
     * 4. 可以在渐变中使用 rgba() 设置透明度
     * 5. 示例：linear-gradient(135deg, #ff5733 0%, #ff8a00 50%, #ffa500 100%)
     */
    
    /* 选中文本样式 */
    /* 背景颜色（包含透明度，格式：rgba(r, g, b, opacity)） */
    --selection-bg-color: rgba(77, 158, 255, 0.3);
    /* 文字颜色 */
    --selection-text-color: var(--text-0);
    /* 边框宽度（通过调整背景色实现，实际边框不支持） */
    --selection-border-width: 1px;
    /* 边框颜色（用于参考，实际通过调整背景色实现） */
    --selection-border-color: var(--primary-400);
    
    /* 盒子内外边距 */
    --box-margin-top: 0px;
    --box-margin-right: 0px;
    --box-margin-bottom: 0px;
    --box-margin-left: 0px;
    --box-margin: var(--box-margin-top) var(--box-margin-right) var(--box-margin-bottom) var(--box-margin-left);
    --box-padding-top: 0px;
    --box-padding-right: 0px;
    --box-padding-bottom: 0px;
    --box-padding-left: 0px;
    --box-padding: var(--box-padding-top) var(--box-padding-right) var(--box-padding-bottom) var(--box-padding-left);
    
    /* 盒子边框 */
    --box-border-width: 0px;
    --box-border-style: solid;
    --box-border-color: transparent;
    --box-border: var(--box-border-width) var(--box-border-style) var(--box-border-color);
    --box-border-top: var(--box-border-width) var(--box-border-style) var(--box-border-color);
    --box-border-right: var(--box-border-width) var(--box-border-style) var(--box-border-color);
    --box-border-bottom: var(--box-border-width) var(--box-border-style) var(--box-border-color);
    --box-border-left: var(--box-border-width) var(--box-border-style) var(--box-border-color);
}

/* ==================== 日间模式 ==================== */
[data-theme="light"] {
    /* ==================== 🔴 背景颜色（必须修改） ==================== */
    /* 基础背景色 - 从深到浅的层次（控制整个应用的背景） */
    --bg-0: #fafbfc;  /* 🔴 最深层背景（页面主背景） */
    --bg-1: #ffffff;  /* 🔴 主背景 */
    --bg-2: #f5f7fa;  /* 🔴 次要背景 */
    --bg-3: #eef2f7;  /* 🔴 三级背景 */
    --bg-4: #e5eaf0;  /* 🔴 四级背景 */
    
    /* 表面颜色 - 用于卡片、面板、按钮等（控制所有可交互元素的背景） */
    --surface-0: #ffffff;  /* 🔴 表面0（最浅） */
    --surface-1: #f5f7fa;  /* 🔴 表面1 */
    --surface-2: #eef2f7;  /* 🔴 表面2（按钮默认背景） */
    --surface-3: #e5eaf0;  /* 🔴 表面3（按钮hover背景） */
    
    /* 边框颜色 */
    --border-subtle: rgba(0, 0, 0, 0.06);
    --border-base: rgba(0, 0, 0, 0.1);
    --border-strong: rgba(0, 0, 0, 0.15);
    --border-emphasis: rgba(0, 0, 0, 0.2);
    
    /* 文字颜色 */
    --text-0: #0a0e1a;
    --text-1: #1a2235;
    --text-2: #394869;
    --text-3: #5a6d8f;
    --text-4: #8a95b5;
    
    /* 主色调 - 蓝色系 */
    --primary-400: #3d8aff;
    --primary-500: #1a6aff;
    --primary-600: #0052d9;
    
    /* 强调色 - 紫色系 */
    --accent-500: #7a5dff;
    --accent-600: #5d3fff;
    
    /* 状态颜色 */
    --success: #22c55e;
    --warning: #eab308;
    --error: #ef4444;
    --info: #3b82f6;
    
    /* 兼容旧变量 */
    --bg-primary: var(--bg-2);
    --bg-secondary: var(--bg-1);
    --bg-tertiary: var(--bg-3);
    --bg-body: var(--bg-0);
    --bg-pane: var(--surface-0);
    --text-primary: var(--text-1);
    --text-secondary: var(--text-2);
    --text-muted: var(--text-3);
    --accent-blue: var(--primary-500);
    --accent-purple: var(--accent-500);
    --border: var(--border-base);
    --border-light: var(--border-subtle);
    --accent-bg: rgba(26, 106, 255, 0.08);
    --code-bg: rgba(237, 242, 255, 0.8);
    
    /* 界面尺寸 */
    --sidebar-width: 220px;
    --font-size: 15px;
    --border-radius: 8px;
    --border-radius-lg: 12px;
    
    /* 字体 */
    --font-ui: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --font-read: 'Inter', 'Microsoft YaHei', sans-serif;
    --font-code: 'JetBrains Mono', Consolas, monospace;
    
    /* ==================== 🎨 滚动条样式（支持渐变色） ==================== */
    /* 滚动条尺寸 */
    --scrollbar-width: 10px;
    --scrollbar-height: 10px;
    --scrollbar-thumb-radius: 5px;
    --scrollbar-track-radius: 5px;
    
    /* 滚动条颜色（纯色，用于 Firefox 和 fallback） */
    --scrollbar-thumb-color: var(--primary-500);
    --scrollbar-thumb-hover-color: var(--primary-600);
    --scrollbar-track-color: var(--surface-2);
    
    /* 滚动条透明度 */
    --scrollbar-thumb-opacity: 0.8;
    --scrollbar-thumb-hover-opacity: 1;
    --scrollbar-track-opacity: 0.3;
    
    /* 滚动条阴影效果 */
    --scrollbar-thumb-shadow: 0 2px 8px rgba(26, 106, 255, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2);
    --scrollbar-thumb-hover-shadow: 0 4px 16px rgba(26, 106, 255, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.3);
    
    /* 🎨 滚动条渐变（WebKit 浏览器会显示渐变，Firefox 使用上面的纯色） */
    /* 格式：linear-gradient(角度, 颜色1 位置%, 颜色2 位置%) */
    /* 示例：linear-gradient(135deg, #388E3C 0%, #689F38 50%, #8BC34A 100%) */
    --scrollbar-thumb-gradient: linear-gradient(135deg, var(--primary-500) 0%, var(--accent-500) 100%);
    --scrollbar-thumb-hover-gradient: linear-gradient(135deg, var(--primary-600) 0%, var(--accent-600) 100%);
    
    /* 💡 渐变色设置提示：
     * 1. 必须同时设置 --scrollbar-thumb-color 和 --scrollbar-thumb-gradient
     *    原因：Firefox 不支持渐变，会自动使用纯色变量
     * 2. 渐变角度建议使用 135deg（从左上到右下），视觉效果最佳
     * 3. 可以在渐变中使用 var() 引用其他颜色变量
     * 4. 可以在渐变中使用 rgba() 设置透明度
     * 5. 示例：linear-gradient(135deg, #388E3C 0%, #689F38 50%, #8BC34A 100%)
     */
    
    /* 选中文本样式 */
    /* 背景颜色（包含透明度，格式：rgba(r, g, b, opacity)） */
    --selection-bg-color: rgba(26, 106, 255, 0.3);
    /* 文字颜色 */
    --selection-text-color: var(--text-0);
    /* 边框宽度（通过调整背景色实现，实际边框不支持） */
    --selection-border-width: 1px;
    /* 边框颜色（用于参考，实际通过调整背景色实现） */
    --selection-border-color: var(--primary-500);
    
    /* 盒子内外边距 */
    --box-margin-top: 0px;
    --box-margin-right: 0px;
    --box-margin-bottom: 0px;
    --box-margin-left: 0px;
    --box-margin: var(--box-margin-top) var(--box-margin-right) var(--box-margin-bottom) var(--box-margin-left);
    --box-padding-top: 0px;
    --box-padding-right: 0px;
    --box-padding-bottom: 0px;
    --box-padding-left: 0px;
    --box-padding: var(--box-padding-top) var(--box-padding-right) var(--box-padding-bottom) var(--box-padding-left);
    
    /* 盒子边框 */
    --box-border-width: 0px;
    --box-border-style: solid;
    --box-border-color: transparent;
    --box-border: var(--box-border-width) var(--box-border-style) var(--box-border-color);
    --box-border-top: var(--box-border-width) var(--box-border-style) var(--box-border-color);
    --box-border-right: var(--box-border-width) var(--box-border-style) var(--box-border-color);
    --box-border-bottom: var(--box-border-width) var(--box-border-style) var(--box-border-color);
    --box-border-left: var(--box-border-width) var(--box-border-style) var(--box-border-color);
}

/* ==================== 🔴 滚动条样式修复（关键修复） ==================== */
/* Firefox滚动条 - 使用纯色（不支持渐变） */
* {
    scrollbar-width: thin !important;
    scrollbar-color: var(--scrollbar-thumb-color) var(--scrollbar-track-color) !important;
}

/* WebKit滚动条基础样式 */
*::-webkit-scrollbar,
::-webkit-scrollbar {
    width: var(--scrollbar-width, 10px) !important;
    height: var(--scrollbar-height, 10px) !important;
    background: transparent !important;
}

/* 滚动条滑块 - 修复渐变应用问题 */
*::-webkit-scrollbar-thumb,
::-webkit-scrollbar-thumb {
    /* 关键修复：使用background-image应用渐变，background-color作为fallback */
    background-image: var(--scrollbar-thumb-gradient) !important;
    background-color: var(--scrollbar-thumb-color) !important;
    /* 如果渐变未定义，使用纯色 */
    background: var(--scrollbar-thumb-gradient, var(--scrollbar-thumb-color)) !important;
    border-radius: var(--scrollbar-thumb-radius, 5px) !important;
    transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1) !important;
    opacity: var(--scrollbar-thumb-opacity, 0.8) !important;
    box-shadow: var(--scrollbar-thumb-shadow, 0 2px 8px rgba(77, 158, 255, 0.4)) !important;
    border: 2px solid transparent !important;
    background-clip: padding-box !important;
    position: relative !important;
    min-height: 20px !important;
    min-width: 20px !important;
}

/* 滚动条滑块悬停效果 */
*::-webkit-scrollbar-thumb:hover,
::-webkit-scrollbar-thumb:hover {
    background-image: var(--scrollbar-thumb-hover-gradient) !important;
    background-color: var(--scrollbar-thumb-hover-color) !important;
    background: var(--scrollbar-thumb-hover-gradient, var(--scrollbar-thumb-hover-color)) !important;
    box-shadow: var(--scrollbar-thumb-hover-shadow, 0 4px 16px rgba(77, 158, 255, 0.6)) !important;
    opacity: var(--scrollbar-thumb-hover-opacity, 1) !important;
    transform: scale(1.05) !important;
}

*::-webkit-scrollbar-thumb:active,
::-webkit-scrollbar-thumb:active {
    background-image: var(--scrollbar-thumb-hover-gradient) !important;
    background-color: var(--scrollbar-thumb-hover-color) !important;
    background: var(--scrollbar-thumb-hover-gradient, var(--scrollbar-thumb-hover-color)) !important;
    opacity: 1 !important;
    transform: scale(1.02) !important;
}

/* 滚动条轨道 */
*::-webkit-scrollbar-track,
::-webkit-scrollbar-track {
    background: var(--scrollbar-track-color) !important;
    border-radius: var(--scrollbar-track-radius, 5px) !important;
    opacity: var(--scrollbar-track-opacity, 0.2) !important;
    transition: opacity 200ms ease !important;
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.05)) !important;
    margin: 4px !important;
}

*::-webkit-scrollbar-track:hover,
::-webkit-scrollbar-track:hover {
    opacity: calc(var(--scrollbar-track-opacity, 0.2) * 1.5) !important;
}

/* 滚动条角落 */
*::-webkit-scrollbar-corner,
::-webkit-scrollbar-corner {
    background: var(--scrollbar-track-color) !important;
    opacity: var(--scrollbar-track-opacity, 0.2) !important;
    border-radius: var(--scrollbar-track-radius, 5px) !important;
}

/* ==================== 🎨 基础样式 - 渐变色应用 ==================== */
/* 以下样式展示了如何在各个元素中应用渐变色效果 */

* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

/* Body 背景渐变 */
body {
    font-family: var(--font-read);
    font-size: var(--font-size);
    line-height: 1.6;
    color: var(--text-primary);
    background: var(--bg-0);
    background-image: var(--bg-gradient-0, var(--bg-0));
    background-attachment: fixed;
    min-height: 100vh;
    overflow-x: hidden;
    transition: background-color var(--transition-base, 200ms), color var(--transition-base, 200ms), background-image var(--transition-base, 200ms);
    position: relative;
}

body::before {
    content: '';
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--bg-gradient-0, var(--bg-0));
    background-image: var(--bg-gradient-0, var(--bg-0));
    z-index: -1;
    opacity: 0.95;
}

/* 链接渐变文字 */
a {
    color: var(--primary-400);
    text-decoration: none;
    transition: color var(--transition-fast, 150ms);
    background: var(--primary-gradient, var(--primary-400));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

a:hover {
    background: var(--primary-gradient-hover, var(--primary-500));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    text-decoration: underline;
    filter: brightness(1.2);
}

/* 标题渐变文字 */
h1, h2, h3, h4, h5, h6 {
    color: var(--text-0);
    font-weight: 600;
    line-height: 1.3;
    margin-top: 1.5em;
    margin-bottom: 0.5em;
}

h1 { 
    font-size: 2.5em;
    background: var(--primary-gradient, var(--primary-400));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

h2 { 
    font-size: 2em;
    background: var(--accent-gradient, var(--accent-500));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

h3 { 
    font-size: 1.5em;
    background: linear-gradient(135deg, var(--primary-400) 0%, var(--primary-500) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

h4 { 
    font-size: 1.25em;
    background: linear-gradient(135deg, var(--primary-500) 0%, var(--accent-500) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

h5 { 
    font-size: 1.125em;
    background: linear-gradient(135deg, var(--accent-500) 0%, var(--accent-600) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

h6 { 
    font-size: 1em;
    background: linear-gradient(135deg, var(--primary-400) 0%, var(--accent-500) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

/* 代码样式 - 渐变背景 */
code {
    font-family: var(--font-code);
    font-size: 0.9em;
    background: var(--code-bg, var(--surface-1));
    background-image: var(--code-bg, var(--surface-gradient-1, var(--surface-1)));
    color: var(--text-1);
    padding: 0.2em 0.4em;
    border-radius: 4px;
    border: 1px solid var(--border-subtle);
    position: relative;
}

pre {
    font-family: var(--font-code);
    font-size: 0.9em;
    background: var(--code-bg, var(--surface-1));
    background-image: var(--code-bg, var(--surface-gradient-1, var(--surface-1)));
    color: var(--text-1);
    padding: 1em;
    border-radius: var(--border-radius, 8px);
    border: 2px solid var(--border-base);
    overflow-x: auto;
    margin: 1em 0;
    line-height: 1.5;
    position: relative;
    box-shadow: 0 3px 12px rgba(0, 0, 0, 0.15);
}

pre::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--primary-gradient, var(--primary-400));
    border-radius: var(--border-radius, 8px) var(--border-radius, 8px) 0 0;
    opacity: 0.6;
}

pre code {
    background: transparent;
    padding: 0;
    border: none;
    font-size: inherit;
}

/* 选中文本 - 渐变背景 */
::selection {
    background: var(--selection-bg-color, var(--primary-400));
    background-image: var(--selection-bg-color, var(--primary-gradient, var(--primary-400)));
    color: var(--selection-text-color, var(--text-0));
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

::-moz-selection {
    background: var(--selection-bg-color, var(--primary-400));
    background-image: var(--selection-bg-color, var(--primary-gradient, var(--primary-400)));
    color: var(--selection-text-color, var(--text-0));
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

/* 聚焦状态 - 渐变外发光 */
:focus-visible {
    outline: none;
    border: 2px solid var(--primary-400);
    outline-offset: 2px;
    border-radius: 4px;
    box-shadow: 0 0 0 2px var(--primary-400), 0 0 0 4px var(--accent-bg, rgba(77, 158, 255, 0.1)), 0 0 10px var(--primary-400), 0 0 20px var(--accent-500);
}

/* 按钮 - 渐变背景 */
button {
    font-family: var(--font-ui);
    font-size: var(--font-size);
    background: var(--surface-2);
    background-image: var(--surface-gradient-2, var(--surface-2));
    color: var(--text-primary);
    border: 2px solid transparent;
    border-radius: var(--border-radius, 8px);
    padding: 0.5em 1em;
    cursor: pointer;
    transition: all var(--transition-base, 200ms);
    position: relative;
    overflow: hidden;
}

button::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--primary-gradient, var(--primary-400));
    opacity: 0;
    transition: opacity var(--transition-base, 200ms);
    z-index: -1;
}

button::after {
    content: '';
    position: absolute;
    top: -2px;
    left: -2px;
    right: -2px;
    bottom: -2px;
    background: var(--border-base, var(--primary-gradient, var(--primary-400)));
    background-image: var(--border-base, var(--primary-gradient, var(--primary-400)));
    border-radius: var(--border-radius, 8px);
    z-index: -2;
    opacity: 0.5;
    transition: opacity var(--transition-base, 200ms);
}

button:hover {
    background: var(--surface-3);
    background-image: var(--surface-gradient-3, var(--surface-3));
    transform: translateY(-1px);
    box-shadow: 0 4px 20px rgba(77, 158, 255, 0.4), 0 8px 30px rgba(138, 109, 255, 0.3);
}

button:hover::before {
    opacity: 0.15;
}

button:hover::after {
    opacity: 1;
}

button:active {
    transform: translateY(0);
    background: var(--primary-gradient, var(--primary-400));
    background-image: var(--primary-gradient, var(--primary-400));
}

button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background: var(--surface-2);
    background-image: var(--surface-gradient-2, var(--surface-2));
}

/* 输入框 - 渐变背景和聚焦效果 */
input, textarea, select {
    font-family: var(--font-ui);
    font-size: var(--font-size);
    background: var(--surface-0);
    background-image: var(--surface-gradient-0, var(--surface-0));
    color: var(--text-primary);
    border: 1px solid var(--border-base);
    border-radius: var(--border-radius, 8px);
    padding: 0.5em 0.75em;
    transition: all var(--transition-base, 200ms);
}

input:focus, textarea:focus, select:focus {
    outline: none;
    border: 2px solid var(--primary-400);
    background: var(--surface-gradient-0, var(--surface-0));
    background-image: var(--surface-gradient-0, var(--surface-0));
    box-shadow: 0 0 0 2px var(--primary-400), 0 0 0 4px var(--accent-bg, rgba(77, 158, 255, 0.1)), 0 0 10px var(--primary-400), 0 4px 20px rgba(77, 158, 255, 0.4);
}

/* 卡片 - 渐变背景 */
.card {
    background: var(--surface-0);
    background-image: var(--surface-gradient-0, var(--surface-0));
    border: 1px solid var(--border-base);
    border-radius: var(--border-radius-lg, 12px);
    padding: 1.5em;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3), 0 0 20px rgba(77, 158, 255, 0.2);
    transition: all var(--transition-base, 200ms);
}

.card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 20px rgba(77, 158, 255, 0.4), 0 8px 30px rgba(138, 109, 255, 0.3);
}

/* 表格 - 渐变背景 */
table {
    width: 100%;
    border-collapse: collapse;
    background: var(--surface-0);
    background-image: var(--surface-gradient-0, var(--surface-0));
    border-radius: var(--border-radius, 8px);
    overflow: hidden;
}

th, td {
    padding: 0.75em 1em;
    border-bottom: 2px solid transparent;
    background-image: linear-gradient(to bottom, transparent, var(--border-subtle));
    background-size: 100% 2px;
    background-repeat: no-repeat;
    background-position: bottom;
    text-align: left;
}

th {
    background: var(--surface-1);
    background-image: var(--surface-gradient-1, var(--primary-gradient, var(--surface-1)));
    font-weight: 600;
    color: var(--text-0);
    position: relative;
}

th::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--primary-gradient, var(--primary-400));
    opacity: 0.5;
}

tr:hover {
    background: var(--surface-1);
    background-image: linear-gradient(90deg, var(--surface-gradient-1, var(--surface-1)), var(--accent-bg, rgba(77, 158, 255, 0.08)));
}

/* 引用块 - 渐变边框和背景 */
blockquote {
    border-left: 4px solid var(--primary-400);
    margin: 1.5em 0;
    padding-left: 1.5em;
    font-style: italic;
    color: var(--text-2);
    background: var(--accent-bg, rgba(77, 158, 255, 0.08));
    background-image: var(--accent-bg, linear-gradient(135deg, rgba(77, 158, 255, 0.1), rgba(138, 109, 255, 0.1)));
    border-radius: 0 var(--border-radius, 8px) var(--border-radius, 8px) 0;
    padding: 1em;
    position: relative;
    overflow: hidden;
}

blockquote::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    background: var(--primary-gradient, var(--primary-400));
    border-radius: 0 2px 2px 0;
}

/* 水平线 - 渐变 */
hr {
    border: none;
    height: 2px;
    background: var(--border-base, var(--primary-400));
    background-image: var(--border-base, var(--primary-gradient, var(--primary-400)));
    margin: 2em 0;
    border-radius: 1px;
    opacity: 0.6;
}

/* 图片 - 渐变边框效果 */
img {
    max-width: 100%;
    height: auto;
    border-radius: var(--border-radius, 8px);
    border: 2px solid var(--border-subtle);
    background: var(--surface-0);
    background-image: var(--surface-gradient-0, var(--surface-0));
    padding: 2px;
    box-shadow: 0 3px 12px rgba(0, 0, 0, 0.15);
    transition: all var(--transition-base, 200ms);
    position: relative;
}

img::before {
    content: '';
    position: absolute;
    top: -2px;
    left: -2px;
    right: -2px;
    bottom: -2px;
    background: var(--border-base, var(--primary-gradient, var(--primary-400)));
    background-image: var(--border-base, var(--primary-gradient, var(--primary-400)));
    border-radius: var(--border-radius, 8px);
    z-index: -1;
    opacity: 0.5;
}

img:hover {
    border-color: var(--primary-400);
    box-shadow: 0 4px 20px rgba(77, 158, 255, 0.4), 0 8px 30px rgba(138, 109, 255, 0.3);
    transform: translateY(-2px);
}

img:hover::before {
    opacity: 1;
}

/* ==================== 重要提示 ==================== */
/* 
 * 🔴 必须修改的内容：
 * 1. 背景颜色变量（--bg-0 到 --bg-4 和 --surface-0 到 --surface-3）
 *    这些变量控制整个应用的背景，是主题的核心！
 * 
 * 2. 文字颜色变量（--text-0 到 --text-4）
 *    确保与背景颜色有足够的对比度，保证可读性
 * 
 * 3. 主色调变量（--primary-400, --primary-500, --primary-600）
 *    控制按钮、链接等强调元素的颜色
 * 
 * 4. 圆角变量（--border-radius）
 *    控制所有按钮和卡片的圆角大小
 * 
 * 5. 滚动条样式变量（--scrollbar-*）
 *    控制滚动条的外观，包括颜色、渐变、阴影等
 *    注意：滚动条样式已自动应用，只需修改变量即可
 * 
 * 6. 渐变变量（--*-gradient）
 *    控制各种元素的渐变效果
 *    - --bg-gradient-0 到 --bg-gradient-4: 背景渐变
 *    - --surface-gradient-0 到 --surface-gradient-3: 表面渐变
 *    - --primary-gradient, --accent-gradient: 主色调渐变
 *    - --scrollbar-thumb-gradient: 滚动条渐变
 *    注意：所有渐变样式已自动应用到相应元素，只需修改变量即可
 * 
 * 使用步骤：
 * 1. 修改上述变量值（特别是背景颜色和渐变）
 * 2. 点击"保存"按钮保存主题
 * 3. 如果主题已应用，需要重新选择该主题才能看到更新
 * 4. 或者使用"预览"功能实时查看效果
 * 
 * 注意：
 * - 主题CSS会覆盖默认样式，确保所有必要的变量都已定义
 * - 所有按钮的背景颜色从 --surface-2 和 --surface-3 读取（支持渐变）
 * - 所有按钮的圆角从 --border-radius 读取（如果定义了）
 * - 滚动条样式会自动应用，支持渐变效果（WebKit浏览器）和纯色（Firefox）
 * - 渐变样式已自动应用到：标题、链接、按钮、输入框、卡片、表格、代码块等
 * - 如果定义了渐变变量，会自动使用渐变；否则使用纯色 fallback
 * - 建议保持颜色层次感，确保视觉一致性
 * - 渐变角度建议使用 135deg（从左上到右下），视觉效果最佳
 * 
 * ⚠️ 语法检查清单（生成主题时请确保）：
 * - 所有注释格式正确：/* ... */（不能写成 /* ... / 或 /* ...）
 * - 没有孤立的文本行（所有说明都在注释里，不要有单独的 "text" 行）
 * - 每个变量声明以分号结尾：--variable-name: value;
 * - :root 和 [data-theme="light"] 块都有完整的大括号 {}
 * - 颜色值格式正确（#rrggbb 或 rgba(r,g,b,a)）
 * - 系统会自动修复部分常见错误（如注释格式），但最好一开始就写对
 */`;
    
    content.textContent = template;
    panel.style.display = 'block';
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.loadThemes = loadThemes;
    window.renderThemesList = renderThemesList;
    window.selectTheme = selectTheme;
    window.applyThemeCSS = applyThemeCSS;
    window.applyThemeFromState = applyThemeFromState;
    window.updateThemeDisplay = updateThemeDisplay;
    window.clearTheme = clearTheme;
    window.toggleThemeMode = toggleThemeMode;
    window.newTheme = newTheme;
    window.saveTheme = saveTheme;
    window.resetThemeForm = resetThemeForm;
    window.editTheme = editTheme;
    window.removeTheme = removeTheme;
    window.importTheme = importTheme;
    window.exportTheme = exportTheme;
    window.previewTheme = previewTheme;
    window.formatThemeCSS = formatThemeCSS;
    window.showThemeTemplate = showThemeTemplate;
}
