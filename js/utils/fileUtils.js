/**
 * 文件工具函数
 * 提供文件相关的工具方法
 */

/**
 * 检查是否为支持的文件类型
 */
export function isSupportedFileType(path) {
    const ext = path.split('.').pop().toLowerCase();
    return ext === 'txt' || ext === 'md';
}

/**
 * 清理文件名（提取表/章标识）
 * 兼容多种格式：表数字-数字、第数字-数字表、第数字章、数字章、数字表等
 */
export function cleanFileName(name) {
    const patterns = [
        /([第\d]+-\d+表)/i,  // 第数字-数字表
        /(表\d+-\d+)/i,      // 表数字-数字
        /(第\d+章)/i,        // 第数字章
        /(^\d+章)/i,         // 数字章
        /(^\d+表)/i,         // 数字表
    ];
    
    for (const pattern of patterns) {
        const match = name.match(pattern);
        if (match) {
            return match[0];
        }
    }
    
    return name;
}

/**
 * 判断是否为表格文件
 */
export function isTableFile(name) {
    const patterns = [
        /[第\d]+-\d+表/i,  // 第数字-数字表
        /表\d+-\d+/i,      // 表数字-数字
        /^\d+表/i,         // 数字表（单个数字+表）
    ];
    return patterns.some(pattern => pattern.test(name));
}

/**
 * 判断是否为章节文件
 */
export function isChapterFile(name) {
    const patterns = [
        /第\d+章/i,        // 第数字章
        /^\d+章/i,         // 数字章
    ];
    return patterns.some(pattern => pattern.test(name));
}

/**
 * 获取表格排序号（提取第一个数字）
 */
export function getTableSortNumber(name) {
    // 匹配格式：表数字-数字、第数字-数字表、数字表
    const patterns = [
        /表(\d+)-\d+/i,     // 表数字-数字，提取第一个数字
        /第(\d+)-\d+表/i,   // 第数字-数字表，提取第一个数字
        /^(\d+)表/i,        // 数字表，提取数字
    ];
    
    for (const pattern of patterns) {
        const match = name.match(pattern);
        if (match && match[1]) {
            return parseInt(match[1], 10);
        }
    }
    return Infinity; // 如果不是表文件，返回最大值，排在最后
}

/**
 * 获取表格排序键（用于多级排序）
 * 返回一个数组：[第一个数字, 第二个数字, ...]
 * 例如："表1-10" -> [1, 10], "表2-1" -> [2, 1]
 */
export function getTableSortKey(name) {
    // 匹配格式：表数字-数字
    const pattern1 = /表(\d+)-(\d+)/i;
    let match = name.match(pattern1);
    if (match && match[1] && match[2]) {
        return [parseInt(match[1], 10), parseInt(match[2], 10)];
    }
    
    // 匹配格式：第数字-数字表
    const pattern2 = /第(\d+)-(\d+)表/i;
    match = name.match(pattern2);
    if (match && match[1] && match[2]) {
        return [parseInt(match[1], 10), parseInt(match[2], 10)];
    }
    
    // 匹配格式：数字表（单个数字）
    const pattern3 = /^(\d+)表/i;
    match = name.match(pattern3);
    if (match && match[1]) {
        return [parseInt(match[1], 10), 0];
    }
    
    return [Infinity, Infinity]; // 如果不是表文件，返回最大值，排在最后
}

/**
 * 获取章节排序号
 */
export function getChapterSortNumber(name) {
    // 匹配格式：第数字章、数字章
    const patterns = [
        /第(\d+)章/i,       // 第数字章，提取数字
        /^(\d+)章/i,        // 数字章，提取数字
    ];
    
    for (const pattern of patterns) {
        const match = name.match(pattern);
        if (match && match[1]) {
            return parseInt(match[1], 10);
        }
    }
    return Infinity; // 如果不是章文件，返回最大值，排在最后
}

/**
 * 获取文件名文件夹路径
 * @param {string} filePath - 文件路径
 * @returns {string} 文件名文件夹路径
 */
export function getFileFolderPath(filePath) {
    const lastSeparatorIndex = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
    const dir = lastSeparatorIndex >= 0 ? filePath.substring(0, lastSeparatorIndex + 1) : '';
    const fileName = lastSeparatorIndex >= 0 ? filePath.substring(lastSeparatorIndex + 1) : filePath;
    const lastDotIndex = fileName.lastIndexOf('.');
    const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
    
    return `${dir}${baseName}/`;
}

/**
 * 获取文件名文件夹内的文件路径
 * @param {string} filePath - 原文件路径
 * @param {string} targetFileName - 目标文件名（如：test_analysis.md）
 * @returns {string} 文件名文件夹内的文件路径
 */
export function getFileInFolderPath(filePath, targetFileName) {
    const folderPath = getFileFolderPath(filePath);
    return `${folderPath}${targetFileName}`;
}

/**
 * 检查是否为文件名文件夹（与某个文件名同名的文件夹）
 * 优先级：如果有同名文件（非zip），隐藏文件夹；如果只有同名zip文件，不隐藏文件夹（zip会被隐藏）
 * @param {string} dirName - 文件夹名称
 * @param {Array} files - 文件列表
 * @returns {boolean} true表示应该隐藏文件夹
 */
export function isFileFolder(dirName, files) {
    // 首先检查是否存在同名文件（非zip，即md或txt文件）
    const hasNonZipFile = files.some(file => {
        const fileName = file.name.toLowerCase();
        // 只检查md和txt文件（这些是会被显示的文件）
        if (!fileName.endsWith('.md') && !fileName.endsWith('.txt')) {
            return false;
        }
        const lastDotIndex = file.name.lastIndexOf('.');
        const baseName = lastDotIndex > 0 ? file.name.substring(0, lastDotIndex) : file.name;
        return baseName === dirName;
    });
    
    // 如果有同名文件（非zip），隐藏文件夹（优先级高）
    if (hasNonZipFile) {
        return true;
    }
    
    // 如果没有同名文件，检查是否有同名zip文件
    const hasZipFile = files.some(file => {
        const fileName = file.name.toLowerCase();
        if (!fileName.endsWith('.zip')) {
            return false;
        }
        const lastDotIndex = file.name.lastIndexOf('.');
        const baseName = lastDotIndex > 0 ? file.name.substring(0, lastDotIndex) : file.name;
        return baseName === dirName;
    });
    
    // 如果只有同名zip文件，不隐藏文件夹（zip会被隐藏，文件夹保留显示）
    if (hasZipFile) {
        return false;
    }
    
    // 既没有同名文件也没有同名zip，不隐藏文件夹
    return false;
}

/**
 * 递归获取目录下的所有文件（仅md文件）
 * @param {string} dirPath - 目录路径
 * @returns {Promise<Array>} 文件路径数组
 */
export async function getAllFilesInDirectory(dirPath) {
    const { getDirectory } = await import('../core/api.js');
    const files = [];
    
    async function scanDirectory(path) {
        try {
            const data = await getDirectory(path);
            
            // 添加当前目录下的文件（仅md）
            const currentDirFiles = [];
            data.files.forEach(file => {
                const fileName = file.name.toLowerCase();
                if (fileName.endsWith('.md')) {
                    // 跳过软删除的文件
                    if (!file.name.endsWith('.deleted')) {
                        files.push(file.path);
                        // 记录文件名（不含扩展名）用于后续判断
                        const lastDotIndex = file.name.lastIndexOf('.');
                        const baseName = lastDotIndex > 0 ? file.name.substring(0, lastDotIndex) : file.name;
                        currentDirFiles.push(baseName);
                    }
                }
            });
            
            // 递归扫描子目录
            for (const dir of data.directories) {
                // 跳过软删除的目录
                if (!dir.name.endsWith('.deleted')) {
                    // 判定逻辑：如果文件夹名和文件名一样，就不去那个文件夹找了
                    const isFileFolder = currentDirFiles.includes(dir.name);
                    if (!isFileFolder) {
                        await scanDirectory(dir.path);
                    } else {
                        console.log(`跳过文件名文件夹: ${dir.path} (与文件 ${dir.name} 同名)`);
                    }
                }
            }
        } catch (error) {
            console.error(`扫描目录失败: ${path}`, error);
        }
    }
    
    await scanDirectory(dirPath);
    return files;
}
