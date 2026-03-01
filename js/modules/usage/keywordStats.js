/**
 * 关键字统计模块
 * 负责从反馈文件中提取关键字（<<关键字>>格式），并统计出现次数
 */

import { getFile, saveFile, getDirectory, createFolder } from '../../core/api.js';

const KEYWORD_DIR = 'fankui_log/guanjianzi';
const DEFAULT_FILES_PER_LIB = 100; // 默认每100个反馈文件合为一个关键字库

/**
 * 获取每库文件数量配置（从localStorage读取，支持持久化）
 * @returns {number} 每库文件数量
 */
function getFilesPerLib() {
    try {
        const saved = localStorage.getItem('keywordStatsConfig');
        if (saved) {
            const config = JSON.parse(saved);
            if (config.filesPerLib && config.filesPerLib > 0) {
                return config.filesPerLib;
            }
        }
    } catch (err) {
        console.warn('[关键字统计] 读取配置失败，使用默认值:', err);
    }
    return DEFAULT_FILES_PER_LIB;
}

/**
 * 保存每库文件数量配置
 * @param {number} filesPerLib - 每库文件数量
 */
function saveFilesPerLib(filesPerLib) {
    try {
        const saved = localStorage.getItem('keywordStatsConfig');
        const config = saved ? JSON.parse(saved) : {};
        config.filesPerLib = filesPerLib;
        localStorage.setItem('keywordStatsConfig', JSON.stringify(config));
    } catch (err) {
        console.error('[关键字统计] 保存配置失败:', err);
    }
}

/**
 * 导出获取和保存配置的函数
 */
export { getFilesPerLib, saveFilesPerLib };

// 识别规则缓存
let recognitionRulesCache = null;
let recognitionRulesCacheTime = 0;
const CACHE_DURATION = 60000; // 缓存1分钟

/**
 * 获取所有启用的识别规则（带缓存）
 * @returns {Promise<Array>} 启用的识别规则数组
 */
async function getEnabledRecognitionRules() {
    const now = Date.now();
    // 如果缓存有效，直接返回
    if (recognitionRulesCache && (now - recognitionRulesCacheTime) < CACHE_DURATION) {
        return recognitionRulesCache;
    }
    
    try {
        const { getAllRecognitionRules } = await import('./keywordRecognitionManager.js');
        const allRules = await getAllRecognitionRules();
        // 只返回启用的规则
        const enabledRules = allRules.filter(rule => {
            return rule.enabled === true || rule.enabled === 'true' || rule.enabled === '是' || rule.enabled === '1' || rule.enabled === 'yes';
        });
        
        // 更新缓存
        recognitionRulesCache = enabledRules;
        recognitionRulesCacheTime = now;
        
        return enabledRules;
    } catch (err) {
        console.warn('[关键字统计] 获取识别规则失败，使用默认规则:', err);
        // 如果获取失败，返回默认规则
        return [{
            startSymbol: '<<',
            endSymbol: '>>',
            enabled: true
        }];
    }
}

/**
 * 转义正则表达式特殊字符
 * @param {string} str - 待转义的字符串
 * @returns {string} 转义后的字符串
 */
function escapeRegex(str) {
    if (!str) return '';
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从文本中提取所有关键字（支持多规则识别）
 * @param {string} text - 文本内容
 * @param {Array} rules - 识别规则数组（可选，如果不提供则自动获取）
 * @returns {Promise<Array<string>>} 关键字数组
 */
export async function extractKeywords(text, rules = null) {
    if (!text || typeof text !== 'string') return [];
    
    // 如果没有提供规则，则获取启用的规则
    if (!rules) {
        rules = await getEnabledRecognitionRules();
    }
    
    // 如果没有启用的规则，使用默认规则
    if (!rules || rules.length === 0) {
        rules = [{
            startSymbol: '<<',
            endSymbol: '>>',
            enabled: true
        }];
    }
    
    // 按规则的长度排序：先处理长规则，再处理短规则，避免短规则截取长规则的关键字
    // 排序依据：startSymbol + endSymbol 的总长度
    const sortedRules = [...rules]
        .filter(rule => rule.enabled)
        .sort((a, b) => {
            const aLen = (a.startSymbol || '<<').length + (a.endSymbol || '>>').length;
            const bLen = (b.startSymbol || '<<').length + (b.endSymbol || '>>').length;
            return bLen - aLen; // 降序：长规则优先
        });
    
    const keywords = [];
    const foundMatches = new Set(); // 用于去重：存储完整匹配文本
    const matchedPositions = []; // 记录已匹配的文本位置，避免重叠匹配
    const excludedRanges = []; // 记录被排除的文本范围（用于更精确的重叠检测）
    
    // 辅助函数：检查位置是否在已排除的范围内
    function isInExcludedRange(start, end) {
        for (const range of excludedRanges) {
            if (start >= range.start && end <= range.end) {
                return true;
            }
        }
        return false;
    }
    
    // 辅助函数：检查位置是否与已匹配位置重叠
    function isOverlappingWithMatched(start, end) {
        for (const pos of matchedPositions) {
            if (!(end <= pos.start || start >= pos.end)) {
                return true;
            }
        }
        return false;
    }
    
    // 对每个启用的规则进行匹配（按长度从长到短）
    for (const rule of sortedRules) {
        const startSymbol = rule.startSymbol || '<<';
        const endSymbol = rule.endSymbol || '>>';
        
        // 转义特殊字符
        const startEscaped = escapeRegex(startSymbol);
        const endEscaped = escapeRegex(endSymbol);
        
        // 构建正则表达式：匹配 startSymbol关键字endSymbol
        const endFirstChar = endSymbol.charAt(0);
        const endFirstCharEscaped = escapeRegex(endFirstChar);
        
        let patternStr;
        if (endSymbol.length === 1) {
            // 单字符endSymbol：使用字符类 [^char] 更高效
            patternStr = `${startEscaped}([^${endFirstCharEscaped}]+?)${endEscaped}`;
        } else {
            // 多字符endSymbol：使用负向前瞻，匹配任意字符直到遇到完整的endSymbol
            patternStr = `${startEscaped}((?:(?!${endEscaped}).)+?)${endEscaped}`;
        }
        
        let pattern;
        try {
            pattern = new RegExp(patternStr, 'g');
        } catch (err) {
            console.error(`[关键字统计] 构建正则表达式失败 (规则: ${startSymbol}...${endSymbol}):`, err, 'patternStr:', patternStr);
            continue; // 跳过这个规则
        }
        
        // 重置正则表达式的lastIndex，确保每次规则都从头开始匹配
        pattern.lastIndex = 0;
        
        // 在匹配前，先找出所有可能的长规则startSymbol位置，用于排除短规则的错误匹配
        const longerStartSymbols = [];
        for (const otherRule of sortedRules) {
            const otherStart = otherRule.startSymbol || '<<';
            // 如果其他规则的startSymbol更长，且当前规则的startSymbol是其前缀
            if (otherStart.length > startSymbol.length && otherStart.startsWith(startSymbol)) {
                // 找出文本中所有这个长startSymbol的位置
                let searchIndex = 0;
                while (true) {
                    const foundIndex = text.indexOf(otherStart, searchIndex);
                    if (foundIndex === -1) break;
                    longerStartSymbols.push({
                        start: foundIndex,
                        end: foundIndex + otherStart.length,
                        symbol: otherStart
                    });
                    searchIndex = foundIndex + 1;
                }
            }
        }
        
        let match;
        let lastIndex = 0;
        while ((match = pattern.exec(text)) !== null) {
            // 防止无限循环
            if (match.index === lastIndex && lastIndex > 0) {
                console.warn(`[关键字统计] 正则表达式可能陷入无限循环，跳过 (规则: ${startSymbol}...${endSymbol})`);
                break;
            }
            lastIndex = match.index;
            
            const matchStart = match.index;
            const matchEnd = match.index + match[0].length;
            const fullMatch = match[0];
            
            // 检查是否在已排除的范围内
            if (isInExcludedRange(matchStart, matchEnd)) {
                continue;
            }
            
            // 检查是否与已匹配的位置重叠（包括部分重叠）
            if (isOverlappingWithMatched(matchStart, matchEnd)) {
                continue;
            }
            
            // 关键修复：检查短规则是否从长规则符号的中间开始匹配
            // 需要同时检查已匹配位置和文本中的长startSymbol位置
            let shouldExclude = false;
            
            // 第一层检查：检查已匹配的位置
            for (const pos of matchedPositions) {
                // 如果当前匹配与已匹配位置有任何重叠，直接排除
                if (!(matchEnd <= pos.start || matchStart >= pos.end)) {
                    shouldExclude = true;
                    break;
                }
                
                // 检查符号重叠：如果短规则的startSymbol是长规则startSymbol的前缀
                const posStartSymbol = pos.startSymbol || '<<';
                
                // 如果已匹配的规则使用了更长的startSymbol，且当前规则的startSymbol是其前缀
                if (posStartSymbol.length > startSymbol.length && posStartSymbol.startsWith(startSymbol)) {
                    // 检查当前匹配的起始位置是否在已匹配区域的startSymbol范围内
                    const posStartSymbolEnd = pos.start + posStartSymbol.length;
                    if (matchStart >= pos.start && matchStart < posStartSymbolEnd) {
                        shouldExclude = true;
                        console.log(`[关键字统计] 排除短规则匹配: ${startSymbol}...${endSymbol} 从位置 ${matchStart} 开始，在长规则 ${posStartSymbol}...${pos.endSymbol} 的startSymbol范围内 (已匹配位置: ${pos.start}-${pos.end})`);
                        break;
                    }
                }
            }
            
            // 第二层检查：检查文本中的长startSymbol位置（即使长规则还没有匹配）
            if (!shouldExclude && longerStartSymbols.length > 0) {
                for (const longSymbol of longerStartSymbols) {
                    // 如果当前匹配的startSymbol起始位置在长startSymbol的范围内，排除
                    if (matchStart >= longSymbol.start && matchStart < longSymbol.end) {
                        shouldExclude = true;
                        console.log(`[关键字统计] 排除短规则匹配: ${startSymbol}...${endSymbol} 从位置 ${matchStart} 开始，与长startSymbol ${longSymbol.symbol} (位置 ${longSymbol.start}-${longSymbol.end}) 重叠`);
                        break;
                    }
                }
            }
            
            // 第三层检查：实时检查文本中当前位置是否有更长的startSymbol
            // 这可以处理预扫描遗漏的情况
            if (!shouldExclude) {
                // 检查当前匹配位置之前是否有更长的startSymbol
                // 检查范围：从 matchStart - maxLongSymbolLength + 1 到 matchStart + startSymbol.length
                const maxLongSymbolLength = sortedRules.length > 0 
                    ? Math.max(...sortedRules.map(r => (r.startSymbol || '<<').length))
                    : startSymbol.length;
                const checkStart = Math.max(0, matchStart - maxLongSymbolLength + 1);
                const checkEnd = Math.min(text.length, matchStart + startSymbol.length);
                const checkText = text.substring(checkStart, checkEnd);
                
                // 检查所有更长的startSymbol
                for (const otherRule of sortedRules) {
                    const otherStart = otherRule.startSymbol || '<<';
                    
                    // 如果其他规则使用了更长的startSymbol，且当前规则的startSymbol是其前缀
                    if (otherStart.length > startSymbol.length && otherStart.startsWith(startSymbol)) {
                        // 在检查范围内查找这个更长的startSymbol
                        let searchIndex = 0;
                        while (true) {
                            const longSymbolIndex = checkText.indexOf(otherStart, searchIndex);
                            if (longSymbolIndex === -1) break;
                            
                            const actualLongSymbolStart = checkStart + longSymbolIndex;
                            const actualLongSymbolEnd = actualLongSymbolStart + otherStart.length;
                            
                            // 如果长startSymbol的位置与当前匹配的startSymbol位置重叠，排除
                            if (matchStart >= actualLongSymbolStart && matchStart < actualLongSymbolEnd) {
                                shouldExclude = true;
                                console.log(`[关键字统计] 排除短规则匹配: 在位置 ${matchStart} 实时发现更长的startSymbol ${otherStart} (位置 ${actualLongSymbolStart}-${actualLongSymbolEnd})，排除短规则 ${startSymbol}...${endSymbol}`);
                                break;
                            }
                            
                            searchIndex = longSymbolIndex + 1;
                        }
                        
                        if (shouldExclude) break;
                    }
                }
            }
            
            if (shouldExclude) {
                continue;
            }
            
            const keyword = match[1] ? match[1].trim() : '';
            if (keyword) {
                // 使用完整匹配作为唯一标识，避免重复
                const uniqueKey = `${startSymbol}${keyword}${endSymbol}`;
                
                // 验证匹配的完整性：确保匹配的文本确实以startSymbol开头，以endSymbol结尾
                const actualMatchText = text.substring(matchStart, matchEnd);
                if (!actualMatchText.startsWith(startSymbol) || !actualMatchText.endsWith(endSymbol)) {
                    console.warn(`[关键字统计] 匹配不完整: 期望 ${startSymbol}...${endSymbol}，实际匹配: ${actualMatchText.substring(0, 20)}...`);
                    continue;
                }
                
                // 关键修复：验证关键字内容的独立性
                // 一个有效的关键字应该是"独立"的，即其内容本身不应该包含其他规则的关键字格式
                // 如果关键字内容包含其他规则的关键字格式，说明这个匹配可能是错误的
                // 应该让其他规则来正确拆分，而不是将整个字符串作为一个关键字
                let isValidKeyword = true;
                
                // 检查关键字内容中是否包含任何其他规则的关键字格式
                for (const otherRule of sortedRules) {
                    const otherStart = otherRule.startSymbol || '<<';
                    const otherEnd = otherRule.endSymbol || '>>';
                    
                    // 跳过当前规则本身
                    if (otherStart === startSymbol && otherEnd === endSymbol) {
                        continue;
                    }
                    
                    // 检查关键字内容中是否包含其他规则的关键字格式
                    // 使用与提取关键字相同的正则表达式逻辑
                    const otherStartEscaped = escapeRegex(otherStart);
                    const otherEndEscaped = escapeRegex(otherEnd);
                    const otherEndFirstChar = otherEnd.charAt(0);
                    const otherEndFirstCharEscaped = escapeRegex(otherEndFirstChar);
                    
                    let otherPatternStr;
                    if (otherEnd.length === 1) {
                        otherPatternStr = `${otherStartEscaped}([^${otherEndFirstCharEscaped}]+?)${otherEndEscaped}`;
                    } else {
                        otherPatternStr = `${otherStartEscaped}((?:(?!${otherEndEscaped}).)+?)${otherEndEscaped}`;
                    }
                    
                    try {
                        const otherPattern = new RegExp(otherPatternStr);
                        // 检查关键字内容中是否包含其他规则的关键字格式
                        // 使用test方法，如果匹配到，说明关键字内容包含了其他规则的关键字格式
                        if (otherPattern.test(keyword)) {
                            // 如果包含，说明这个关键字内容本身包含了其他规则的关键字格式
                            // 这意味着当前匹配可能是错误的，应该被拆分成多个独立的关键字
                            // 跳过当前匹配，让其他规则来正确拆分
                            isValidKeyword = false;
                            console.log(`[关键字统计] 关键字内容包含其他规则格式，跳过当前匹配: ${uniqueKey} (包含规则: ${otherStart}...${otherEnd})`);
                            break;
                        }
                    } catch (err) {
                        // 忽略正则表达式构建错误
                        console.warn(`[关键字统计] 构建其他规则正则表达式失败:`, err);
                    }
                }
                
                // 如果关键字内容是独立的（不包含其他规则的关键字格式），才认为是有效的独立关键字
                if (isValidKeyword && !foundMatches.has(uniqueKey)) {
                    foundMatches.add(uniqueKey);
                    // 返回包含规则信息的关键字对象，而不是只返回关键字文本
                    keywords.push({
                        keyword: keyword,
                        startSymbol: startSymbol,
                        endSymbol: endSymbol,
                        fullMatch: uniqueKey
                    });
                    matchedPositions.push({ start: matchStart, end: matchEnd, rule: `${startSymbol}...${endSymbol}`, startSymbol, endSymbol });
                    console.log(`[关键字统计] 提取到关键字: ${uniqueKey} (规则: ${startSymbol}...${endSymbol}, 位置: ${matchStart}-${matchEnd}, 完整匹配: ${actualMatchText})`);
                }
            }
        }
    }
    
    return keywords;
}

/**
 * 清除识别规则缓存（当规则更新时调用）
 */
export function clearRecognitionRulesCache() {
    recognitionRulesCache = null;
    recognitionRulesCacheTime = 0;
}

/**
 * 确保关键字目录存在
 */
async function ensureKeywordDir() {
    try {
        await getDirectory(KEYWORD_DIR);
    } catch (err) {
        // 目录不存在，创建它
        try {
            await createFolder(KEYWORD_DIR);
        } catch (createErr) {
            console.warn('[关键字统计] 创建关键字目录失败:', createErr);
        }
    }
}

/**
 * 获取关键字库文件名
 * @param {number} libIndex - 库索引（从0开始）
 * @returns {string} 库文件名
 */
function getKeywordLibFileName(libIndex) {
    return `keywords_lib_${String(libIndex).padStart(4, '0')}.json`;
}

/**
 * 获取关键字库路径
 * @param {number} libIndex - 库索引
 * @returns {string} 库文件路径
 */
function getKeywordLibPath(libIndex) {
    return `${KEYWORD_DIR}/${getKeywordLibFileName(libIndex)}`;
}

/**
 * 读取关键字库
 * @param {number} libIndex - 库索引
 * @returns {Promise<object>} 关键字库数据 {processedFiles: Set, keywords: Map}
 */
async function readKeywordLib(libIndex) {
    try {
        const libPath = getKeywordLibPath(libIndex);
        const content = await getFile(libPath);
        const data = JSON.parse(content);
        
        // 转换Set和Map（JSON序列化时会丢失）
        return {
            processedFiles: new Set(data.processedFiles || []),
            keywords: new Map(data.keywords || [])
        };
    } catch (err) {
        // 库不存在，返回空数据
        return {
            processedFiles: new Set(),
            keywords: new Map()
        };
    }
}

/**
 * 保存关键字库
 * @param {number} libIndex - 库索引
 * @param {object} libData - 库数据 {processedFiles: Set, keywords: Map}
 */
async function saveKeywordLib(libIndex, libData) {
    try {
        await ensureKeywordDir();
        
        const libPath = getKeywordLibPath(libIndex);
        const data = {
            processedFiles: Array.from(libData.processedFiles),
            keywords: Array.from(libData.keywords.entries())
        };
        
        await saveFile(libPath, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error(`[关键字统计] 保存关键字库失败 (lib ${libIndex}):`, err);
        throw err;
    }
}

/**
 * 获取所有已处理反馈文件的索引文件路径
 */
function getProcessedFilesIndexPath() {
    return `${KEYWORD_DIR}/processed_files_index.json`;
}

/**
 * 获取规则配置版本文件路径
 */
function getRulesVersionPath() {
    return `${KEYWORD_DIR}/rules_version.json`;
}

/**
 * 生成规则配置的签名（用于检测规则变化）
 * @param {Array} rules - 规则数组
 * @returns {string} 规则配置签名
 */
function generateRulesSignature(rules) {
    if (!rules || rules.length === 0) {
        return 'default';
    }
    
    // 对规则进行排序，确保相同规则集合生成相同签名
    const sortedRules = [...rules].sort((a, b) => {
        const aKey = `${a.startSymbol || ''}|${a.endSymbol || ''}|${a.enabled ? '1' : '0'}`;
        const bKey = `${b.startSymbol || ''}|${b.endSymbol || ''}|${b.enabled ? '1' : '0'}`;
        return aKey.localeCompare(bKey);
    });
    
    // 生成签名：包含所有启用的规则的startSymbol和endSymbol
    const signature = sortedRules
        .filter(rule => rule.enabled)
        .map(rule => `${rule.startSymbol || '<<'}|${rule.endSymbol || '>>'}`)
        .join(';');
    
    return signature || 'default';
}

/**
 * 读取规则配置版本
 * @returns {Promise<object>} {version: string, timestamp: number}
 */
async function readRulesVersion() {
    try {
        const versionPath = getRulesVersionPath();
        const content = await getFile(versionPath);
        const data = JSON.parse(content);
        return {
            version: data.version || '',
            timestamp: data.timestamp || 0
        };
    } catch (err) {
        return {
            version: '',
            timestamp: 0
        };
    }
}

/**
 * 保存规则配置版本
 * @param {string} version - 规则配置签名
 */
async function saveRulesVersion(version) {
    try {
        await ensureKeywordDir();
        const versionPath = getRulesVersionPath();
        const data = {
            version: version,
            timestamp: Date.now()
        };
        await saveFile(versionPath, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('[关键字统计] 保存规则版本失败:', err);
    }
}

/**
 * 检查规则配置是否发生变化
 * @returns {Promise<boolean>} 如果规则配置发生变化，返回true
 */
export async function checkRulesVersionChanged() {
    try {
        const currentRules = await getEnabledRecognitionRules();
        const currentSignature = generateRulesSignature(currentRules);
        const savedVersion = await readRulesVersion();
        
        if (savedVersion.version !== currentSignature) {
            console.log(`[关键字统计] 规则配置已变化: "${savedVersion.version}" -> "${currentSignature}"`);
            // 更新版本
            await saveRulesVersion(currentSignature);
            return true;
        }
        
        return false;
    } catch (err) {
        console.error('[关键字统计] 检查规则版本失败:', err);
        return false;
    }
}

/**
 * 清除所有已处理文件索引（强制重新处理所有文件）
 */
async function clearProcessedFilesIndex() {
    try {
        const indexPath = getProcessedFilesIndexPath();
        // 删除索引文件
        try {
            await getFile(indexPath);
            // 如果文件存在，创建一个空索引
            await saveProcessedFilesIndex(new Map());
        } catch (err) {
            // 文件不存在，忽略
        }
        
        // 同时清除所有关键字库文件
        try {
            const dirData = await getDirectory(KEYWORD_DIR);
            const libFiles = dirData.files.filter(f => f.name.startsWith('keywords_lib_') && f.name.endsWith('.json'));
            for (const libFile of libFiles) {
                try {
                    // 删除库文件（通过保存空内容）
                    await saveFile(libFile.path, JSON.stringify({ processedFiles: [], keywords: [] }, null, 2));
                } catch (err) {
                    console.warn(`[关键字统计] 清除库文件失败: ${libFile.path}`, err);
                }
            }
            console.log(`[关键字统计] 已清除 ${libFiles.length} 个关键字库文件`);
        } catch (err) {
            console.warn('[关键字统计] 清除关键字库文件失败:', err);
        }
        
        console.log('[关键字统计] 已清除所有已处理文件索引，将重新处理所有文件');
    } catch (err) {
        console.error('[关键字统计] 清除已处理文件索引失败:', err);
    }
}

/**
 * 读取已处理文件索引
 * @returns {Promise<Map>} 文件路径 -> 库索引的映射
 */
async function readProcessedFilesIndex() {
    try {
        const indexPath = getProcessedFilesIndexPath();
        const content = await getFile(indexPath);
        const data = JSON.parse(content);
        return new Map(data);
    } catch (err) {
        return new Map();
    }
}

/**
 * 保存已处理文件索引
 * @param {Map} index - 文件路径 -> 库索引的映射
 */
async function saveProcessedFilesIndex(index) {
    try {
        await ensureKeywordDir();
        const indexPath = getProcessedFilesIndexPath();
        const data = Array.from(index.entries());
        await saveFile(indexPath, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('[关键字统计] 保存已处理文件索引失败:', err);
    }
}

/**
 * 处理单个反馈文件，提取关键字
 * @param {string} filePath - 反馈文件路径
 * @returns {Promise<boolean>} 是否成功处理（如果已处理过则返回false）
 */
export async function processFeedbackFile(filePath, forceReprocess = false) {
    try {
        // 读取已处理文件索引
        const processedIndex = await readProcessedFilesIndex();
        
        // 检查是否已处理（除非强制重新处理）
        if (!forceReprocess && processedIndex.has(filePath)) {
            return false; // 已处理过，跳过
        }
        
        // 如果强制重新处理，需要先从已处理的库中移除该文件
        if (forceReprocess && processedIndex.has(filePath)) {
            const oldLibIndex = processedIndex.get(filePath);
            if (oldLibIndex >= 0) {
                try {
                    const oldLibData = await readKeywordLib(oldLibIndex);
                    oldLibData.processedFiles.delete(filePath);
                    // 需要重新统计该库的关键字（移除该文件的关键字）
                    // 这里简化处理：如果文件被重新处理，旧的关键字统计会被覆盖
                    await saveKeywordLib(oldLibIndex, oldLibData);
                } catch (err) {
                    console.warn(`[关键字统计] 从旧库中移除文件失败: ${filePath}`, err);
                }
            }
            // 从索引中移除
            processedIndex.delete(filePath);
        }
        
        // 读取反馈文件内容
        const content = await getFile(filePath);
        
        // 检查是否是错误响应
        if (content && typeof content === 'string' && content.trim().startsWith('{') && content.includes('"error"')) {
            console.warn(`[关键字统计] 文件不存在或无法读取: ${filePath}`);
            return false;
        }
        
        // 提取关键字（支持多规则）
        const keywords = await extractKeywords(content);
        
        // 格式化关键字用于日志显示
        const keywordDisplay = keywords.slice(0, 5).map(k => {
            if (typeof k === 'string') return k;
            return k.fullMatch || `${k.startSymbol}${k.keyword}${k.endSymbol}`;
        }).join(', ');
        
        console.log(`[关键字统计] 从文件 ${filePath.split('/').pop()} 提取到 ${keywords.length} 个关键字:`, keywordDisplay);
        
        if (keywords.length === 0) {
            // 没有关键字，标记为已处理但不需要保存
            processedIndex.set(filePath, -1); // -1表示已处理但无关键字
            await saveProcessedFilesIndex(processedIndex);
            // 返回true表示文件已处理（虽然没找到关键字），这样统计时能正确计数
            return true;
        }
        
        // 确定应该使用哪个库（根据已处理的文件数量）
        const totalProcessed = processedIndex.size;
        const filesPerLib = getFilesPerLib();
        const libIndex = Math.floor(totalProcessed / filesPerLib);
        
        // 读取或创建库
        const libData = await readKeywordLib(libIndex);
        
        // 添加文件到已处理列表
        libData.processedFiles.add(filePath);
        
        // 统计关键字出现次数（使用fullMatch作为唯一键，保存规则信息）
        keywords.forEach(keywordObj => {
            // 兼容旧格式：如果keywordObj是字符串，转换为对象
            const keyword = typeof keywordObj === 'string' 
                ? { keyword: keywordObj, startSymbol: '<<', endSymbol: '>>', fullMatch: `<<${keywordObj}>>` }
                : keywordObj;
            
            // 使用fullMatch作为唯一键
            const key = keyword.fullMatch || `${keyword.startSymbol}${keyword.keyword}${keyword.endSymbol}`;
            const existing = libData.keywords.get(key);
            
            if (existing) {
                // 如果已存在，增加计数
                existing.count = (existing.count || 1) + 1;
            } else {
                // 新建条目，保存完整信息
                libData.keywords.set(key, {
                    keyword: keyword.keyword,
                    startSymbol: keyword.startSymbol,
                    endSymbol: keyword.endSymbol,
                    fullMatch: key,
                    count: 1
                });
            }
        });
        
        // 保存库
        await saveKeywordLib(libIndex, libData);
        
        // 更新已处理文件索引
        processedIndex.set(filePath, libIndex);
        await saveProcessedFilesIndex(processedIndex);
        
        console.log(`[关键字统计] 已处理反馈文件: ${filePath}，提取到 ${keywords.length} 个关键字，保存到库 ${libIndex}`);
        
        return true;
    } catch (err) {
        console.error(`[关键字统计] 处理反馈文件失败 (${filePath}):`, err);
        return false;
    }
}

/**
 * 扫描并处理所有新的反馈文件
 * @param {boolean} forceReprocess - 是否强制重新处理所有文件（忽略已处理标记）
 * @returns {Promise<number>} 处理的文件数量
 */
export async function scanAndProcessNewFeedbackFiles(forceReprocess = false) {
    try {
        const { getDirectory } = await import('../../core/api.js');
        
        // 检查规则配置是否发生变化（用于更新规则版本记录）
        const rulesChanged = await checkRulesVersionChanged();
        
        // 如果强制重新处理，清除已处理文件索引（无论规则是否变化）
        if (forceReprocess) {
            console.log('[关键字统计] 强制重新处理，清除已处理文件索引');
            await clearProcessedFilesIndex();
        } else if (rulesChanged) {
            // 如果只是规则变化（非强制），也清除索引
            console.log('[关键字统计] 规则配置已变化，清除已处理文件索引');
            await clearProcessedFilesIndex();
        }
        
        // 读取已处理文件索引
        const processedIndex = await readProcessedFilesIndex();
        
        // 扫描所有反馈文件
        const feedbackFiles = [];
        
        try {
            const baseData = await getDirectory('fankui_log');
            
            // 遍历年月文件夹
            for (const yearMonthDir of baseData.directories) {
                if (!yearMonthDir.name.match(/^\d{6}$/)) continue;
                
                try {
                    const yearMonthData = await getDirectory(yearMonthDir.path);
                    
                    // 遍历日文件夹
                    for (const dayDir of yearMonthData.directories) {
                        if (!dayDir.name.match(/^\d{2}$/)) continue;
                        
                        try {
                            const dayData = await getDirectory(dayDir.path);
                            
                            // 遍历所有子文件夹（事件名或工作流名）
                            for (const subDir of dayData.directories) {
                                try {
                                    const subData = await getDirectory(subDir.path);
                                    
                                    // 遍历所有反馈文件
                                    for (const file of subData.files) {
                                        // 跳过.deleted后缀的文件
                                        if (file.name.endsWith('.deleted')) {
                                            continue;
                                        }
                                        
                                        // 检查是否是反馈文件（包含_反馈或_工作流反馈）
                                        if (file.name.includes('_反馈.') || file.name.includes('_工作流反馈.')) {
                                            // 如果强制重新处理，或者规则变化，或者文件未处理过，则加入处理列表
                                            if (forceReprocess || rulesChanged || !processedIndex.has(file.path)) {
                                                feedbackFiles.push(file.path);
                                            }
                                        }
                                    }
                                } catch (err) {
                                    // 忽略无法访问的目录
                                }
                            }
                        } catch (err) {
                            // 忽略无法访问的目录
                        }
                    }
                } catch (err) {
                    // 忽略无法访问的目录
                }
            }
        } catch (err) {
            console.warn('[关键字统计] 扫描反馈文件目录失败:', err);
        }
        
        console.log(`[关键字统计] 扫描到 ${feedbackFiles.length} 个需要处理的反馈文件 (规则变化: ${rulesChanged}, 强制重新处理: ${forceReprocess})`);
        
        // 处理所有新文件（真正并发执行，使用配置的批次大小控制并发数）
        let processedCount = 0;
        let totalFiles = feedbackFiles.length;
        // 使用配置的每批文件数作为并发处理的批次大小
        const BATCH_SIZE = getFilesPerLib();
        const totalBatches = Math.ceil(totalFiles / BATCH_SIZE);
        
        // 创建所有文件的处理Promise，但使用并发控制确保同时处理的文件数不超过BATCH_SIZE
        const allPromises = [];
        const executing = []; // 正在执行的文件Promise
        let completedCount = 0;
        
        // 为每个文件创建处理Promise，使用并发控制
        for (let i = 0; i < feedbackFiles.length; i++) {
            const filePath = feedbackFiles[i];
            const fileIndex = i + 1;
            const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
            
            // 创建处理Promise
            const processPromise = (async () => {
                // 如果当前执行的Promise数量达到批次大小，等待其中一个完成
                if (executing.length >= BATCH_SIZE) {
                    await Promise.race(executing);
                }
                
                // 将当前Promise添加到执行列表
                const currentPromise = processFeedbackFile(filePath, forceReprocess || rulesChanged)
                    .then(success => {
                        completedCount++;
                        if (success) {
                            console.log(`[关键字统计] 批次 ${batchNumber} 进度: ${fileIndex}/${totalFiles} 完成`);
                        }
                        return { filePath, success, batchNumber };
                    })
                    .catch(err => {
                        completedCount++;
                        console.error(`[关键字统计] 处理文件失败: ${filePath}`, err);
                        return { filePath, success: false, batchNumber };
                    })
                    .finally(() => {
                        // 从执行列表中移除
                        const index = executing.indexOf(currentPromise);
                        if (index > -1) {
                            executing.splice(index, 1);
                        }
                    });
                
                executing.push(currentPromise);
                return currentPromise;
            })();
            
            allPromises.push(processPromise);
        }
        
        // 等待所有文件处理完成
        const allResults = await Promise.all(allPromises);
        processedCount = allResults.filter(r => r.success).length;
        
        // 按批次统计并输出日志
        const batchStats = new Map();
        allResults.forEach(result => {
            const batchNum = result.batchNumber;
            if (!batchStats.has(batchNum)) {
                batchStats.set(batchNum, { total: 0, success: 0 });
            }
            const stats = batchStats.get(batchNum);
            stats.total++;
            if (result.success) stats.success++;
        });
        
        batchStats.forEach((stats, batchNum) => {
            console.log(`[关键字统计] 批次 ${batchNum} 完成: ${stats.success}/${stats.total} 个文件处理成功`);
        });
        
        console.log(`[关键字统计] 扫描完成，共处理 ${totalFiles} 个文件，成功处理 ${processedCount} 个反馈文件`);
        
        return processedCount;
    } catch (err) {
        console.error('[关键字统计] 扫描并处理反馈文件失败:', err);
        return 0;
    }
}

/**
 * 获取所有关键字统计数据
 * @param {object} filter - 过滤条件 {type: 'workflow'|'event'|'view', name: string}
 * @returns {Promise<Array>} 关键字统计数组 [{keyword: string, count: number}]
 */
export async function getAllKeywordStats(filter = {}) {
    try {
        await ensureKeywordDir();
        
        // 读取所有关键字库
        const allKeywords = new Map();
        
        try {
            const dirData = await getDirectory(KEYWORD_DIR);
            
            // 查找所有库文件
            const libFiles = dirData.files.filter(f => f.name.startsWith('keywords_lib_') && f.name.endsWith('.json'));
            
            for (const libFile of libFiles) {
                try {
                    const content = await getFile(libFile.path);
                    const libData = JSON.parse(content);
                    
                    // 合并关键字统计
                    if (libData.keywords) {
                        // 确保 keywords 是数组格式
                        if (Array.isArray(libData.keywords)) {
                            libData.keywords.forEach((item) => {
                                // 处理多种可能的格式：
                                // 1. [keyword, count] - 旧格式（字符串关键字）
                                // 2. [fullMatch, {keyword, startSymbol, endSymbol, fullMatch, count}] - 新格式（Map序列化）
                                // 3. {keyword: string, count: number} - 对象格式
                                let keywordObj, count;
                                
                                if (Array.isArray(item)) {
                                    if (item.length === 2) {
                                        // 可能是 [keyword, count] 或 [fullMatch, keywordObj]
                                        if (typeof item[0] === 'string' && typeof item[1] === 'number') {
                                            // 旧格式：[keyword, count]
                                            keywordObj = {
                                                keyword: item[0],
                                                startSymbol: '<<',
                                                endSymbol: '>>',
                                                fullMatch: `<<${item[0]}>>`
                                            };
                                            count = item[1];
                                        } else if (typeof item[0] === 'string' && typeof item[1] === 'object') {
                                            // 新格式：[fullMatch, keywordObj]
                                            keywordObj = item[1];
                                            count = keywordObj.count || 1;
                                        }
                                    }
                                } else if (typeof item === 'object' && item !== null) {
                                    // 对象格式：{keyword, startSymbol, endSymbol, fullMatch, count}
                                    keywordObj = item;
                                    count = item.count || 1;
                                } else {
                                    return; // 跳过无效项
                                }
                                
                                if (keywordObj && keywordObj.keyword) {
                                    // 使用fullMatch作为唯一键
                                    const key = keywordObj.fullMatch || `${keywordObj.startSymbol}${keywordObj.keyword}${keywordObj.endSymbol}`;
                                    const existing = allKeywords.get(key);
                                    
                                    if (existing) {
                                        existing.count = (existing.count || 1) + count;
                                    } else {
                                        allKeywords.set(key, {
                                            keyword: keywordObj.keyword,
                                            startSymbol: keywordObj.startSymbol || '<<',
                                            endSymbol: keywordObj.endSymbol || '>>',
                                            fullMatch: key,
                                            count: count
                                        });
                                    }
                                }
                            });
                        } else if (typeof libData.keywords === 'object' && libData.keywords !== null) {
                            // 如果是对象格式，直接遍历（兼容旧格式）
                            Object.entries(libData.keywords).forEach(([key, value]) => {
                                if (typeof value === 'number') {
                                    // 旧格式：{keyword: count}
                                    const keywordObj = {
                                        keyword: key,
                                        startSymbol: '<<',
                                        endSymbol: '>>',
                                        fullMatch: `<<${key}>>`
                                    };
                                    const existing = allKeywords.get(keywordObj.fullMatch);
                                    if (existing) {
                                        existing.count = (existing.count || 1) + value;
                                    } else {
                                        allKeywords.set(keywordObj.fullMatch, {
                                            ...keywordObj,
                                            count: value
                                        });
                                    }
                                } else if (typeof value === 'object' && value !== null) {
                                    // 新格式：{fullMatch: {keyword, startSymbol, endSymbol, fullMatch, count}}
                                    const keywordObj = value;
                                    const fullMatch = key;
                                    const existing = allKeywords.get(fullMatch);
                                    if (existing) {
                                        existing.count = (existing.count || 1) + (keywordObj.count || 1);
                                    } else {
                                        allKeywords.set(fullMatch, {
                                            keyword: keywordObj.keyword,
                                            startSymbol: keywordObj.startSymbol || '<<',
                                            endSymbol: keywordObj.endSymbol || '>>',
                                            fullMatch: fullMatch,
                                            count: keywordObj.count || 1
                                        });
                                    }
                                }
                            });
                        }
                    }
                } catch (err) {
                    console.warn(`[关键字统计] 读取库文件失败: ${libFile.path}`, err);
                }
            }
            
            console.log(`[关键字统计] 从 ${libFiles.length} 个库文件中读取到 ${allKeywords.size} 个唯一关键字`);
        } catch (err) {
            // 目录不存在或为空，返回空数组
        }
        
        // 如果有过滤条件，需要根据反馈文件路径过滤
        if (filter.type && filter.name) {
            // 需要根据文件路径判断是否属于指定的工作流/事件/视图
            // 这里简化处理，返回所有关键字（实际应该根据文件路径过滤）
            // 由于文件路径中包含事件名和工作流名，可以根据需要进一步过滤
        }
        
        // 转换为数组并排序（保留规则信息）
        const result = Array.from(allKeywords.entries())
            .map(([fullMatch, keywordObj]) => ({
                keyword: keywordObj.keyword,
                startSymbol: keywordObj.startSymbol,
                endSymbol: keywordObj.endSymbol,
                fullMatch: keywordObj.fullMatch || fullMatch,
                count: keywordObj.count || 1
            }))
            .sort((a, b) => b.count - a.count);
        
        return result;
    } catch (err) {
        console.error('[关键字统计] 获取关键字统计数据失败:', err);
        return [];
    }
}

/**
 * 根据工作流/事件/视图获取关键字统计
 * @param {string} type - 类型 'workflow' | 'event' | 'view'
 * @param {string} name - 名称
 * @returns {Promise<Array>} 关键字统计数组
 */
export async function getKeywordStatsByItem(type, name) {
    try {
        await ensureKeywordDir();
        
        // 读取所有关键字库
        const allKeywords = new Map();
        
        try {
            const dirData = await getDirectory(KEYWORD_DIR);
            const libFiles = dirData.files.filter(f => f.name.startsWith('keywords_lib_') && f.name.endsWith('.json'));
            
            for (const libFile of libFiles) {
                try {
                    const content = await getFile(libFile.path);
                    const libData = JSON.parse(content);
                    
                    // 检查每个已处理的文件是否匹配过滤条件
                    if (libData.processedFiles) {
                        for (const filePath of libData.processedFiles) {
                            let matches = false;
                            
                            if (type === 'workflow') {
                                // 工作流反馈文件路径格式：fankui_log/年月/日/工作流名/文件名_工作流反馈.md
                                matches = filePath.includes(`/${name}/`) && filePath.includes('_工作流反馈.');
                            } else if (type === 'event') {
                                // 节点反馈文件路径格式：fankui_log/年月/日/事件名/文件名_视图ID_反馈.md
                                matches = filePath.includes(`/${name}/`) && filePath.includes('_反馈.') && !filePath.includes('_工作流反馈.');
                            } else if (type === 'view') {
                                // 节点反馈文件路径格式：fankui_log/年月/日/事件名/文件名_视图ID_反馈.md
                                matches = filePath.includes(`_${name}_反馈.`);
                            }
                            
                            if (matches && libData.keywords) {
                                // 合并该文件的关键字统计（支持新旧格式）
                                if (Array.isArray(libData.keywords)) {
                                    libData.keywords.forEach((item) => {
                                        let keywordObj, count;
                                        if (Array.isArray(item)) {
                                            if (item.length === 2) {
                                                if (typeof item[0] === 'string' && typeof item[1] === 'number') {
                                                    keywordObj = {
                                                        keyword: item[0],
                                                        startSymbol: '<<',
                                                        endSymbol: '>>',
                                                        fullMatch: `<<${item[0]}>>`
                                                    };
                                                    count = item[1];
                                                } else if (typeof item[0] === 'string' && typeof item[1] === 'object') {
                                                    keywordObj = item[1];
                                                    count = keywordObj.count || 1;
                                                }
                                            }
                                        } else if (typeof item === 'object' && item !== null) {
                                            keywordObj = item;
                                            count = item.count || 1;
                                        }
                                        
                                        if (keywordObj && keywordObj.keyword) {
                                            const key = keywordObj.fullMatch || `${keywordObj.startSymbol}${keywordObj.keyword}${keywordObj.endSymbol}`;
                                            const existing = allKeywords.get(key);
                                            if (existing) {
                                                existing.count = (existing.count || 1) + count;
                                            } else {
                                                allKeywords.set(key, {
                                                    keyword: keywordObj.keyword,
                                                    startSymbol: keywordObj.startSymbol || '<<',
                                                    endSymbol: keywordObj.endSymbol || '>>',
                                                    fullMatch: key,
                                                    count: count
                                                });
                                            }
                                        }
                                    });
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.warn(`[关键字统计] 读取库文件失败: ${libFile.path}`, err);
                }
            }
        } catch (err) {
            // 目录不存在或为空
        }
        
        // 转换为数组并排序（保留规则信息）
        const result = Array.from(allKeywords.entries())
            .map(([fullMatch, keywordObj]) => ({
                keyword: keywordObj.keyword,
                startSymbol: keywordObj.startSymbol,
                endSymbol: keywordObj.endSymbol,
                fullMatch: keywordObj.fullMatch || fullMatch,
                count: keywordObj.count || 1
            }))
            .sort((a, b) => b.count - a.count);
        
        return result;
    } catch (err) {
        console.error(`[关键字统计] 获取关键字统计失败 (${type}: ${name}):`, err);
        return [];
    }
}








































