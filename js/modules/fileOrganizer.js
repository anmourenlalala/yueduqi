/**
 * 文件整理模块
 * 负责将现有文件整理到文件名文件夹中
 */

import { state } from '../core/state.js';
import { getDirectory, getFile, saveFile, createFolder, softDelete } from '../core/api.js';
import { getFileFolderPath, getFileInFolderPath, isFileFolder } from '../utils/fileUtils.js';
import { isSupportedFileType } from '../utils/fileUtils.js';

/**
 * 自动整理当前目录的文件
 * @param {string} dirPath - 目录路径（可选，默认当前目录）
 */
export async function organizeFiles(dirPath = null) {
    const targetDir = dirPath || state.currentDir;
    
    try {
        // 获取目录内容
        const data = await getDirectory(targetDir);
        
        // 找出所有主文件（不是视图后缀文件，不是AI文件）
        const mainFiles = data.files.filter(file => {
            if (!isSupportedFileType(file.name)) return false;
            if (file.name.endsWith('_AI.md') || file.name.endsWith('_AI.txt')) return false;
            
            // 检查是否是视图后缀文件（使用与editor.js相同的判定逻辑）
            let isViewFile = false;
            if (state.views) {
                for (const view of state.views) {
                    // 使用与editor.js相同的判定逻辑
                    const hasSuffix = view.suffix !== undefined && 
                                      view.suffix !== null && 
                                      String(view.suffix).trim() !== '';
                    
                    if (hasSuffix) {
                        const suffix = view.suffix;
                        if (file.name.includes(suffix + '.') || file.name.includes(suffix + '_')) {
                            isViewFile = true;
                            break;
                        }
                    }
                }
            }
            
            return !isViewFile;
        });
        
        let organizedCount = 0;
        let errorCount = 0;
        const errors = [];
        
        for (const mainFile of mainFiles) {
            try {
                const filePath = mainFile.path;
                const fileFolderPath = getFileFolderPath(filePath);
                
                // 创建文件名文件夹
                try {
                    await createFolder(fileFolderPath);
                } catch (err) {
                    // 文件夹可能已存在，忽略
                }
                
                // 主文件保持在根目录（不移动）
                // 只移动视图文件和AI文件到文件名文件夹内
                
                // 查找并移动相关的视图文件和AI文件
                const lastDotIndex = mainFile.name.lastIndexOf('.');
                const baseName = lastDotIndex > 0 ? mainFile.name.substring(0, lastDotIndex) : mainFile.name;
                const ext = lastDotIndex > 0 ? mainFile.name.substring(lastDotIndex + 1) : '';
                
                // 移动视图文件（只移动有suffix的视图文件）
                for (const view of state.views) {
                    // 使用与editor.js相同的判定逻辑：检查suffix是否存在且不为空字符串
                    const hasSuffix = view.suffix !== undefined && 
                                      view.suffix !== null && 
                                      String(view.suffix).trim() !== '';
                    
                    if (hasSuffix) {
                        const viewFileName = `${baseName}${view.suffix}.${ext}`;
                        
                        // 检查文件是否存在（在根目录，不在文件名文件夹内）
                        const viewFile = data.files.find(f => {
                            if (f.name !== viewFileName) return false;
                            
                            // 确保路径在根目录（不在文件名文件夹内）
                            const normalizedPath = f.path.replace(/\\/g, '/');
                            const normalizedTargetDir = targetDir.replace(/\\/g, '/').replace(/\/$/, '');
                            const expectedPath = `${normalizedTargetDir}/${viewFileName}`.replace(/\/+/g, '/');
                            
                            // 路径必须完全匹配，且不在文件名文件夹内
                            return normalizedPath === expectedPath &&
                                   !normalizedPath.includes(`/${baseName}/`) && 
                                   !normalizedPath.includes(`\\${baseName}\\`);
                        });
                        
                        if (viewFile) {
                            try {
                                // 检查目标位置是否已有文件（避免重复）
                                const targetViewFilePath = getFileInFolderPath(filePath, viewFileName);
                                try {
                                    await getFile(targetViewFilePath);
                                    // 如果目标文件已存在，跳过
                                    continue;
                                } catch (err) {
                                    // 目标文件不存在，继续移动
                                }
                                
                                const viewFileContent = await getFile(viewFile.path);
                                await saveFile(targetViewFilePath, viewFileContent);
                                
                                // 删除原文件（软删除）
                                try {
                                    await softDelete(viewFile.path);
                                } catch (err) {
                                    console.warn(`删除原视图文件失败: ${viewFileName}`, err);
                                }
                            } catch (err) {
                                console.error(`移动视图文件失败: ${viewFileName}`, err);
                            }
                        }
                    }
                }
                
                // 移动AI文件（查找所有相关的AI文件，只移动根目录的）
                const aiFiles = data.files.filter(f => {
                    return f.name.startsWith(baseName + '_') && 
                           (f.name.endsWith('_AI.md') || f.name.endsWith('_AI.txt')) &&
                           !f.path.includes(`/${baseName}/`) && !f.path.includes(`\\${baseName}\\`);
                });
                
                for (const aiFile of aiFiles) {
                    try {
                        // 检查目标位置是否已有文件（避免重复）
                        const targetAiFilePath = getFileInFolderPath(filePath, aiFile.name);
                        try {
                            await getFile(targetAiFilePath);
                            // 如果目标文件已存在，跳过
                            continue;
                        } catch (err) {
                            // 目标文件不存在，继续移动
                        }
                        
                        const aiFileContent = await getFile(aiFile.path);
                        await saveFile(targetAiFilePath, aiFileContent);
                        
                        // 删除原文件（软删除）
                        try {
                            await softDelete(aiFile.path);
                        } catch (err) {
                            console.warn(`删除原AI文件失败: ${aiFile.name}`, err);
                        }
                    } catch (err) {
                        console.error(`移动AI文件失败: ${aiFile.name}`, err);
                    }
                }
                
                organizedCount++;
            } catch (error) {
                errorCount++;
                errors.push({
                    file: mainFile.name,
                    error: error.message
                });
                console.error(`整理文件失败: ${mainFile.name}`, error);
            }
        }
        
        // 重新加载目录
        if (window.loadDir) {
            await window.loadDir(targetDir);
        }
        
        return {
            success: true,
            organizedCount,
            errorCount,
            errors
        };
    } catch (error) {
        console.error('自动整理失败:', error);
        throw error;
    }
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.organizeFiles = organizeFiles;
}

