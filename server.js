const express = require('express');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const app = express();
const port = 2333;

// 信任代理（用于正确获取客户端IP）
app.set('trust proxy', true);

// Serve static files
app.use(express.static(path.join(__dirname)));
// Parse JSON bodies with increased size limit (1TB = 1024 * 1024 * 1024 * 1024 bytes)
// 使用数字格式确保正确解析，1TB = 1099511627776 bytes
const ONE_TB = 1024 * 1024 * 1024 * 1024;
app.use(express.json({ limit: ONE_TB }));
app.use(express.urlencoded({ limit: ONE_TB, extended: true }));

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});


// API endpoint to get directory contents
app.get('/api/directory', (req, res) => {
  let directoryPath = req.query.path || __dirname;

  // Resolve the path to get absolute path
  directoryPath = path.resolve(directoryPath);

  // 检查路径是否存在
  if (!fs.existsSync(directoryPath)) {
    return res.status(404).json({ error: 'Path does not exist' });
  }

  // 检查路径是否是文件而不是目录
  const stats = fs.statSync(directoryPath);
  if (!stats.isDirectory()) {
    return res.status(400).json({ error: 'Path is not a directory' });
  }

  fs.readdir(directoryPath, { withFileTypes: true }, (err, files) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      const result = {
        path: directoryPath,
        directories: [],
        files: []
      };

      files.forEach(file => {
        if (file.isDirectory()) {
          result.directories.push({
            name: file.name,
            path: path.join(directoryPath, file.name)
          });
        } else {
          result.files.push({
            name: file.name,
            path: path.join(directoryPath, file.name)
          });
        }
      });

      res.send(result);
    });
});

// API endpoint to get file content
app.get('/api/file', (req, res) => {
  const filePath = path.normalize(req.query.path);

  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      // 文件不存在时返回404，其他错误返回500
      const statusCode = err.code === 'ENOENT' ? 404 : 500;
      return res.status(statusCode).json({ error: err.message });
    }
    // 设置正确的Content-Type
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(data);
  });
});

// API endpoint to save file content
app.post('/api/save-file', (req, res) => {
  const { path: filePath, content } = req.body;

  // Resolve the path
  const resolvedPath = path.resolve(filePath);
  
  // 获取文件所在目录
  const dirPath = path.dirname(resolvedPath);
  
  // 确保目录存在，如果不存在则创建
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  fs.writeFile(resolvedPath, content, 'utf8', (err) => {
    if (err) {
      return res.status(500).send({ error: err.message });
    }
    res.send({ message: 'File saved successfully' });
  });
});

// API endpoint to create a new file
app.post('/api/new-file', (req, res) => {
  const { path: filePath, content = '' } = req.body;

  // Resolve the path
  const resolvedPath = path.resolve(filePath);
  
  // 获取文件所在目录
  const dirPath = path.dirname(resolvedPath);
  
  // 确保目录存在，如果不存在则创建
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  fs.writeFile(resolvedPath, content, 'utf8', (err) => {
    if (err) {
      return res.status(500).send({ error: err.message });
    }
    res.send({ message: 'File created successfully' });
  });
});

// API endpoint to create a new directory
app.post('/api/new-folder', (req, res) => {
  const { path: folderPath } = req.body;

  // Resolve the path
  const resolvedPath = path.resolve(folderPath);

  fs.mkdir(resolvedPath, { recursive: true }, (err) => {
    if (err) {
      return res.status(500).send({ error: err.message });
    }
    res.send({ message: 'Folder created successfully' });
  });
});

// File to persist deleted items
const trashFile = path.join(__dirname, 'trash.json');

// Initialize deleted items array from file
let deletedItems = [];

// Function to save deleted items to file
function saveDeletedItems() {
  try {
    fs.writeFileSync(trashFile, JSON.stringify(deletedItems));
  } catch (err) {
    console.error("Error saving trash data:", err);
  }
}

// Load deleted items from file on startup, but then resync with actual .deleted files
// This ensures we have the most accurate state based on the filesystem
try {
  if (fs.existsSync(trashFile)) {
    const data = fs.readFileSync(trashFile, 'utf8');
    const storedDeletedItems = JSON.parse(data);
    console.log(`从trash.json加载了 ${storedDeletedItems.length} 个项目，但将重新扫描文件系统以确保准确性...`);
  } else {
    // If no trash file exists, create an empty one
    fs.writeFileSync(trashFile, JSON.stringify([]));
  }
} catch (err) {
  console.error("Error loading trash data, will rescan filesystem:", err);
  fs.writeFileSync(trashFile, JSON.stringify([]));
}

// API endpoint to soft delete a file or folder
app.post('/api/soft-delete', (req, res) => {
  const { path: itemPath } = req.body;

  // Resolve the path
  const resolvedPath = path.resolve(itemPath);

  // Get file/folder stats to determine type
  fs.stat(resolvedPath, (err, stats) => {
    if (err) {
      return res.status(500).send({ error: err.message });
    }

    const dirPath = path.dirname(resolvedPath);
    const baseName = path.basename(resolvedPath);
    const isDir = stats.isDirectory();
    
    // 获取基础名称（去掉扩展名）
    let baseNameWithoutExt = baseName;
    if (!isDir) {
      const extIndex = baseName.lastIndexOf('.');
      if (extIndex > 0) {
        baseNameWithoutExt = baseName.substring(0, extIndex);
      }
    }

    // 查找同名文件/文件夹
    const itemsToDelete = [resolvedPath]; // 要删除的项目列表
    
    try {
      const dirItems = fs.readdirSync(dirPath, { withFileTypes: true });
      
      for (const item of dirItems) {
        const fullPath = path.join(dirPath, item.name);
        
        // 跳过当前要删除的项目本身
        if (fullPath === resolvedPath) continue;
        
        // 跳过已经删除的项目
        if (item.name.endsWith('.deleted')) continue;
        
        // 检查是否是同名文件/文件夹
        if (isDir) {
          // 如果删除的是文件夹，查找同名文件
          if (item.isFile()) {
            const fileNameWithoutExt = item.name.substring(0, item.name.lastIndexOf('.')) || item.name;
            if (fileNameWithoutExt === baseName) {
              itemsToDelete.push(fullPath);
            }
          }
        } else {
          // 如果删除的是文件，查找同名文件夹
          if (item.isDirectory() && item.name === baseNameWithoutExt) {
            itemsToDelete.push(fullPath);
          }
        }
      }
    } catch (e) {
      // 如果无法读取目录，继续处理主项目
      console.log('无法读取目录以查找同名项目:', e.message);
    }

    // 检查所有要删除的项目是否已经有.deleted文件
    const deletedPaths = itemsToDelete.map(p => p + '.deleted');
    for (const deletedPath of deletedPaths) {
      try {
        fs.accessSync(deletedPath, fs.constants.F_OK);
        return res.status(409).send({ error: 'A deleted file with this name already exists' });
      } catch (e) {
        // 文件不存在，继续
      }
    }

    // 准备删除的项目信息
    const itemsInfo = [];
    const deletePromises = [];

    for (const itemPathToDelete of itemsToDelete) {
      try {
        const itemStats = fs.statSync(itemPathToDelete);
        const itemInfo = {
          path: itemPathToDelete,
          name: path.basename(itemPathToDelete),
          type: itemStats.isDirectory() ? 'directory' : 'file',
          deletedAt: new Date().toISOString()
        };
        itemsInfo.push(itemInfo);
        deletedItems.push(itemInfo);

        // 创建删除Promise
        const deletedPath = itemPathToDelete + '.deleted';
        deletePromises.push(
          new Promise((resolve, reject) => {
            fs.rename(itemPathToDelete, deletedPath, (err) => {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          })
        );
      } catch (e) {
        console.log(`无法删除项目 ${itemPathToDelete}:`, e.message);
      }
    }

    // 保存到文件
    saveDeletedItems();

    // 执行所有删除操作
    Promise.all(deletePromises)
      .then(() => {
        res.send({ 
          message: 'Item(s) soft deleted successfully', 
          items: itemsInfo,
          count: itemsInfo.length
        });
      })
      .catch((err) => {
        // 如果删除失败，从deletedItems中移除
        for (const itemInfo of itemsInfo) {
          const index = deletedItems.findIndex(item => item.path === itemInfo.path);
          if (index !== -1) {
            deletedItems.splice(index, 1);
          }
        }
        saveDeletedItems();
        return res.status(500).send({ error: err.message });
      });
  });
});

// API endpoint to restore a soft deleted item
app.post('/api/restore-item', async (req, res) => {
  console.log('=== RESTORE REQUEST RECEIVED ===');
  console.log('Request method:', req.method);
  console.log('Request URL:', req.url);
  console.log('Request headers:', req.headers);
  console.log('Full request body:', req.body);
  console.log('Content-Type:', req.headers['content-type']);

  const { path: originalPath } = req.body;

  // Resolve the path
  const resolvedOriginalPath = path.resolve(originalPath);
  console.log('Resolved path:', resolvedOriginalPath);

  // Construct the deleted file path by adding '.deleted' suffix
  const deletedPath = resolvedOriginalPath + '.deleted';
  console.log('Expected deleted file path:', deletedPath);

  // Check if the deleted file/directory actually exists
  try {
    console.log('Checking if deleted file exists at:', deletedPath);
    await fs.promises.access(deletedPath, fs.constants.F_OK);
    console.log('SUCCESS: Found deleted file, proceeding to restore');

    // 获取要恢复的项目信息
    let itemStats;
    try {
      itemStats = await fs.promises.stat(deletedPath);
    } catch (e) {
      return res.status(500).send({ error: '无法获取项目信息' });
    }

    const dirPath = path.dirname(resolvedOriginalPath);
    const baseName = path.basename(resolvedOriginalPath);
    const isDir = itemStats.isDirectory();
    
    // 获取基础名称（去掉扩展名）
    let baseNameWithoutExt = baseName;
    if (!isDir) {
      const extIndex = baseName.lastIndexOf('.');
      if (extIndex > 0) {
        baseNameWithoutExt = baseName.substring(0, extIndex);
      }
    }

    // 查找同名已删除的文件/文件夹
    const itemsToRestore = [resolvedOriginalPath]; // 要恢复的项目列表
    
    try {
      const dirItems = fs.readdirSync(dirPath, { withFileTypes: true });
      
      for (const item of dirItems) {
        // 只检查.deleted文件
        if (!item.name.endsWith('.deleted')) continue;
        
        const fullDeletedPath = path.join(dirPath, item.name);
        
        // 跳过当前要恢复的项目本身
        if (fullDeletedPath === deletedPath) continue;
        
        // 检查是否是同名文件/文件夹
        const originalName = item.name.slice(0, -'.deleted'.length);
        
        if (isDir) {
          // 如果恢复的是文件夹，查找同名已删除的文件
          if (item.isFile()) {
            const fileNameWithoutExt = originalName.substring(0, originalName.lastIndexOf('.')) || originalName;
            if (fileNameWithoutExt === baseName) {
              itemsToRestore.push(path.join(dirPath, originalName));
            }
          }
        } else {
          // 如果恢复的是文件，查找同名已删除的文件夹
          if (item.isDirectory() && originalName === baseNameWithoutExt) {
            itemsToRestore.push(path.join(dirPath, originalName));
          }
        }
      }
    } catch (e) {
      // 如果无法读取目录，继续处理主项目
      console.log('无法读取目录以查找同名项目:', e.message);
    }

    // 恢复所有项目
    const restorePromises = [];
    const restoredItems = [];

    for (const itemPathToRestore of itemsToRestore) {
      const deletedItemPath = itemPathToRestore + '.deleted';
      
      try {
        // 检查.deleted文件是否存在
        await fs.promises.access(deletedItemPath, fs.constants.F_OK);
        
        // 恢复文件/文件夹
        restorePromises.push(
          fs.promises.rename(deletedItemPath, itemPathToRestore)
            .then(() => {
              restoredItems.push(itemPathToRestore);
            })
        );
      } catch (e) {
        console.log(`无法恢复项目 ${itemPathToRestore}:`, e.message);
      }
    }

    // 等待所有恢复操作完成
    await Promise.all(restorePromises);

    // 从deletedItems中移除所有已恢复的项目
    for (const restoredPath of restoredItems) {
      let itemIndex = -1;

      // Method 1: Direct path comparison
      itemIndex = deletedItems.findIndex(item => item.path === restoredPath);

      if (itemIndex === -1) {
          // Method 2: Resolved path comparison
          const resolvedRestoredPath = path.resolve(restoredPath);
          itemIndex = deletedItems.findIndex(item => item.path === resolvedRestoredPath);
      }

      if (itemIndex === -1) {
          // Method 3: Normalize path comparison
          const normalizedPath = restoredPath.replace(/\\/g, '/');
          itemIndex = deletedItems.findIndex(item =>
              item.path.replace(/\\/g, '/') === normalizedPath
          );
      }

      if (itemIndex === -1) {
          // Method 4: Using path.normalize for comparison
          const normalizedPath = path.normalize(restoredPath);
          itemIndex = deletedItems.findIndex(item =>
              path.normalize(item.path) === normalizedPath
          );
      }

      if (itemIndex !== -1) {
        console.log('SUCCESS: Found item at index', itemIndex, 'in trash list, removing it');
        deletedItems.splice(itemIndex, 1);
      }
    }

    saveDeletedItems(); // Save to persistent storage
    console.log('SUCCESS: Removed items from trash list and saved');

    console.log('=== RESTORE COMPLETED SUCCESSFULLY ===');
    res.send({ 
      message: 'Item(s) restored successfully',
      count: restoredItems.length,
      items: restoredItems
    });
  } catch (err) {
    console.log('ERROR: Restore failed with error:', err.message);
    console.log('Full error object:', err);
    if (err.code === 'ENOENT') {
      console.log('ERROR: Deleted file does not exist at expected path');
      return res.status(404).send({ error: 'Deleted item no longer exists on disk' });
    }
    console.log('ERROR: Unexpected error during restore:', err.message);
    return res.status(500).send({ error: err.message });
  }
});

// 检查是否为本地访问的辅助函数（不暴露IP信息）
function isLocalAccessRequest(req) {
  const host = req.get('host') || '';
  const referer = req.get('referer') || '';
  const origin = req.get('origin') || '';
  
  // 检查是否为 localhost
  const isLocalhost = host === `localhost:${port}` || host === `127.0.0.1:${port}`;
  
  // 检查是否为内网IP（使用模式匹配，不暴露具体IP）
  const ipPattern = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/;
  const hostname = host.split(':')[0];
  const isLocalIP = ipPattern.test(hostname);
  
  // 检查端口是否为 2333
  const isCorrectPort = host.endsWith(`:${port}`);
  
  // 综合判断：必须是本地地址且端口正确
  return (isLocalhost || isLocalIP) && isCorrectPort;
}

// API endpoint to permanently delete an item from trash
app.post('/api/permanent-delete', (req, res) => {
  // 检查是否为本地访问
  if (!isLocalAccessRequest(req)) {
    return res.status(403).send({ error: 'Access denied: This operation is only allowed from local access' });
  }

  const { path: itemPath } = req.body;

  const itemIndex = deletedItems.findIndex(item => item.path === itemPath);
  if (itemIndex === -1) {
    return res.status(404).send({ error: 'Item not found in trash' });
  }

  const deletedItem = deletedItems[itemIndex];
  const deletedPath = deletedItem.path + '.deleted';

  // Permanently delete the file/directory
  const removePath = (delPath) => {
    return new Promise((resolve, reject) => {
      fs.rm(delPath, { recursive: true, force: true }, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  };

  removePath(deletedPath)
    .then(() => {
      // Remove from deleted items
      deletedItems.splice(itemIndex, 1);
      saveDeletedItems(); // Save to persistent storage
      res.send({ message: 'Item permanently deleted' });
    })
    .catch(err => {
      res.status(500).send({ error: err.message });
    });
});

// 检查是否为本地访问的辅助函数（不暴露IP信息）
function isLocalAccessRequest(req) {
  const host = req.get('host') || '';
  
  // 检查是否为 localhost
  const isLocalhost = host === `localhost:${port}` || host === `127.0.0.1:${port}`;
  
  // 检查是否为内网IP（使用模式匹配，不暴露具体IP）
  const ipPattern = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/;
  const hostname = host.split(':')[0];
  const isLocalIP = ipPattern.test(hostname);
  
  // 检查端口是否为 2333
  const isCorrectPort = host.endsWith(`:${port}`);
  
  // 综合判断：必须是本地地址且端口正确
  return (isLocalhost || isLocalIP) && isCorrectPort;
}

// API endpoint to get trash items
app.get('/api/trash', (req, res) => {
  console.log('Trash request received, returning', deletedItems.length, 'items');
  console.log('Trash items:', deletedItems);
  res.send({ items: deletedItems });
});

// API endpoint to restore all items from trash
app.post('/api/restore-all', async (req, res) => {
  // 检查是否为本地访问
  if (!isLocalAccessRequest(req)) {
    return res.status(403).send({ error: 'Access denied: This operation is only allowed from local access' });
  }

  if (deletedItems.length === 0) {
    return res.send({ message: 'Trash is already empty', count: 0 });
  }

  const restorePromises = [];
  const restoredItems = [];

  for (const item of deletedItems) {
    const deletedPath = item.path + '.deleted';
    
    try {
      // 检查.deleted文件是否存在
      await fs.promises.access(deletedPath, fs.constants.F_OK);
      
      // 恢复文件/文件夹
      restorePromises.push(
        fs.promises.rename(deletedPath, item.path)
          .then(() => {
            restoredItems.push(item.path);
          })
          .catch(err => {
            console.log(`无法恢复项目 ${item.path}:`, err.message);
          })
      );
    } catch (e) {
      // 文件不存在，跳过
      console.log(`跳过不存在的项目: ${item.path}`);
    }
  }

  try {
    await Promise.all(restorePromises);
    
    // 从deletedItems中移除所有已恢复的项目
    for (const restoredPath of restoredItems) {
      const itemIndex = deletedItems.findIndex(item => item.path === restoredPath);
      if (itemIndex !== -1) {
        deletedItems.splice(itemIndex, 1);
      }
    }
    
    saveDeletedItems();
    res.send({ 
      message: 'All items restored successfully', 
      count: restoredItems.length,
      items: restoredItems
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// API endpoint to permanently delete all items from trash
app.post('/api/permanent-delete-all', (req, res) => {
  // 检查是否为本地访问
  if (!isLocalAccessRequest(req)) {
    return res.status(403).send({ error: 'Access denied: This operation is only allowed from local access' });
  }

  if (deletedItems.length === 0) {
    return res.send({ message: 'Trash is already empty', count: 0 });
  }

  const deletePromises = deletedItems.map(item => {
    const deletedPath = item.path + '.deleted';
    return new Promise((resolve, reject) => {
      fs.rm(deletedPath, { recursive: true, force: true }, (err) => {
        if (err) {
          // 如果文件不存在，也视为成功（可能已经被手动删除）
          if (err.code === 'ENOENT') {
            resolve();
          } else {
            reject(err);
          }
        } else {
          resolve();
        }
      });
    });
  });

  Promise.all(deletePromises)
    .then(() => {
      const count = deletedItems.length;
      deletedItems.length = 0; // 清空数组
      saveDeletedItems();
      res.send({ message: 'All items permanently deleted', count });
    })
    .catch(err => {
      res.status(500).send({ error: err.message });
    });
});

// Function to initialize deleted items by scanning for .deleted files
function initializeDeletedItemsFromFiles() {
  const appRoot = path.resolve(__dirname);

  // First, clear the current deletedItems array to avoid duplicates
  deletedItems = [];

  // Function to recursively search for .deleted files
  function scanDirectory(dirPath) {
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const item of items) {
        const fullPath = path.join(dirPath, item.name);

        if (item.isDirectory()) {
          // Recursively scan subdirectories
          scanDirectory(fullPath);
        } else if (item.name.endsWith('.deleted')) {
          // This is a deleted item, add it to our deletedItems array
          const originalPath = fullPath.slice(0, -'.deleted'.length); // Remove .deleted suffix
          const originalName = item.name.slice(0, -'.deleted'.length); // Remove .deleted suffix from name

          // Check if the .deleted file represents a directory or file
          let itemType = 'file';
          try {
            const stats = fs.statSync(fullPath);
            if (stats.isDirectory()) {
              itemType = 'directory';
            }
          } catch (e) {
            // If we can't stat, default to file
            itemType = 'file';
          }

          // Check if already in deletedItems to avoid duplicates
          const exists = deletedItems.some(existingItem => {
            const normalizedExisting = path.normalize(existingItem.path);
            const normalizedNew = path.normalize(originalPath);
            return normalizedExisting === normalizedNew;
          });

          if (!exists) {
            const itemInfo = {
              path: originalPath,
              name: originalName,
              type: itemType,
              deletedAt: new Date().toISOString()
            };

            deletedItems.push(itemInfo);
            console.log(`发现现有已删除${itemType}: ${fullPath} -> 添加到回收站列表`);
          }
        }
      }
    } catch (err) {
      // Skip directories we can't read (permissions, etc.)
      console.log(`跳过无法访问的目录: ${dirPath}`);
    }
  }

  // Start scanning from the application root
  scanDirectory(appRoot);

  // 扫描项目根目录的父目录下的所有子目录（递归）
  // 例如：当前路径是 D:\积累知识库\yueduqi，应该扫描 D:\积累知识库 下的所有目录
  const parentDir = path.dirname(appRoot);
  const rootPath = path.parse(appRoot).root; // Get the root path (e.g., 'C:\' on Windows or '/' on Unix)
  
  // 只扫描父目录（不继续向上扫描）
  if (parentDir !== appRoot && parentDir !== rootPath) {
    console.log(`扫描父目录及其所有子目录: ${parentDir}`);
    try {
      // 递归扫描父目录下的所有子目录
      scanDirectory(parentDir);
    } catch (err) {
      console.log(`无法访问父目录: ${parentDir}`, err.message);
    }
  }

  // 清理trash.json中实际不存在的文件
  // 从trash.json加载的项目已经在上面被扫描覆盖，这里只需要清理那些实际不存在的.deleted文件
  const itemsToRemove = [];
  for (let i = deletedItems.length - 1; i >= 0; i--) {
    const item = deletedItems[i];
    const deletedPath = item.path + '.deleted';
    
    try {
      // 检查.deleted文件是否实际存在
      fs.accessSync(deletedPath, fs.constants.F_OK);
    } catch (e) {
      // 文件不存在，需要从列表中移除
      console.log(`清理不存在的项目: ${item.path} (${item.name})`);
      itemsToRemove.push(i);
    }
  }
  
  // 从后往前删除，避免索引变化
  for (const index of itemsToRemove) {
    deletedItems.splice(index, 1);
  }

  // Save the updated deletedItems to the file
  saveDeletedItems();
}

// Load deleted items from file on startup, but then resync with actual .deleted files
// This ensures we have the most accurate state based on the filesystem
try {
  if (fs.existsSync(trashFile)) {
    const data = fs.readFileSync(trashFile, 'utf8');
    const storedDeletedItems = JSON.parse(data);
    console.log(`从trash.json加载了 ${storedDeletedItems.length} 个项目，但将重新扫描文件系统以确保准确性...`);
  } else {
    // If no trash file exists, create an empty one
    fs.writeFileSync(trashFile, JSON.stringify([]));
  }
} catch (err) {
  console.error("Error loading trash data, will rescan filesystem:", err);
  fs.writeFileSync(trashFile, JSON.stringify([]));
}

// Initialize deleted items by scanning for existing .deleted files on startup
initializeDeletedItemsFromFiles();

// Initialize the app
console.log(`初始化完成，当前内存中软删除项目数: ${deletedItems.length}`);

// ==================== 主题、布局、提示词和工作流管理 API ====================
const themesDir = path.join(__dirname, 'themes');
const layoutsDir = path.join(__dirname, 'layouts');
const htmlLayoutsDir = path.join(__dirname, 'html-layouts');
const promptsDir = path.join(__dirname, 'prompts');
const workflowsDir = path.join(__dirname, 'workflows');
const eventsDir = path.join(__dirname, 'events');
const viewsDir = path.join(__dirname, 'view');
const viewsConfigFile = path.join(viewsDir, 'views.json');
const viewsDeletedFile = path.join(viewsDir, 'views_delete.json');

const defaultViews = [
  { id: 'original', titleTemplate: '原始文本：{filename}', suffix: '', keybind: 'a' },
  { id: 'analysis', titleTemplate: '分析文本：{filename}', suffix: '_analysis', keybind: 'd' }
];

// 确保目录存在
[themesDir, layoutsDir, htmlLayoutsDir, promptsDir, workflowsDir, eventsDir, viewsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

function normalizeViews(views) {
  if (!Array.isArray(views)) return [];
  return views.map(view => ({
    ...view,
    suffix: view?.suffix ?? ''
  }));
}

function ensureViewsFile() {
  if (!fs.existsSync(viewsConfigFile)) {
    const now = new Date().toISOString();
    const payload = { views: defaultViews, createdAt: now, updatedAt: now };
    fs.writeFileSync(viewsConfigFile, JSON.stringify(payload, null, 2), 'utf8');
  }
}

function ensureViewsDeletedFile() {
  if (!fs.existsSync(viewsDeletedFile)) {
    const now = new Date().toISOString();
    const payload = { deletedViews: [], createdAt: now, updatedAt: now };
    fs.writeFileSync(viewsDeletedFile, JSON.stringify(payload, null, 2), 'utf8');
  }
}

// 初始化视图配置文件
ensureViewsFile();
ensureViewsDeletedFile();

// 视图配置 API（view 目录持久化）
app.get('/api/views', (req, res) => {
  try {
    ensureViewsFile();
    ensureViewsDeletedFile();
    const raw = fs.readFileSync(viewsConfigFile, 'utf8');
    const data = JSON.parse(raw || '{}');
    const deletedRaw = fs.readFileSync(viewsDeletedFile, 'utf8');
    const deletedData = JSON.parse(deletedRaw || '{}');
    let views = normalizeViews(data.views);
    if (views.length === 0) {
      views = defaultViews;
    }
    res.json({
      views,
      deletedViews: Array.isArray(deletedData.deletedViews) ? deletedData.deletedViews : [],
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/views', (req, res) => {
  try {
    const { views, deletedViews } = req.body || {};
    if (!Array.isArray(views)) {
      return res.status(400).json({ error: 'views must be an array' });
    }
    
    ensureViewsFile();
    ensureViewsDeletedFile();
    let createdAt = new Date().toISOString();
    try {
      const existing = JSON.parse(fs.readFileSync(viewsConfigFile, 'utf8'));
      if (existing.createdAt) {
        createdAt = existing.createdAt;
      }
    } catch (_) {
      // ignore read errors, will rewrite file
    }
    
    const normalizedViews = normalizeViews(views);
    const payload = {
      views: normalizedViews,
      createdAt,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(viewsConfigFile, JSON.stringify(payload, null, 2), 'utf8');
    
    // 处理软删除的视图
    let deletedCreatedAt = new Date().toISOString();
    try {
      const existingDeleted = JSON.parse(fs.readFileSync(viewsDeletedFile, 'utf8'));
      if (existingDeleted.createdAt) {
        deletedCreatedAt = existingDeleted.createdAt;
      }
    } catch (_) {
      // ignore
    }
    const normalizedDeleted = Array.isArray(deletedViews) ? deletedViews : (() => {
      try {
        const existingDeleted = JSON.parse(fs.readFileSync(viewsDeletedFile, 'utf8'));
        return Array.isArray(existingDeleted.deletedViews) ? existingDeleted.deletedViews : [];
      } catch (e) {
        return [];
      }
    })();
    const deletedPayload = {
      deletedViews: normalizedDeleted,
      createdAt: deletedCreatedAt,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(viewsDeletedFile, JSON.stringify(deletedPayload, null, 2), 'utf8');
    
    res.json({ message: 'Views saved successfully', views: normalizedViews, deletedViews: normalizedDeleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 主题管理 API
app.get('/api/themes', (req, res) => {
  try {
    const files = fs.readdirSync(themesDir);
    const themes = files
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const filePath = path.join(themesDir, f);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
          name: data.name,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt
        };
      });
    res.json({ themes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/theme/:name', (req, res) => {
  try {
    const fileName = `${req.params.name}.json`;
    const filePath = path.join(themesDir, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Theme not found' });
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/theme', (req, res) => {
  try {
    const { name, css } = req.body;
    if (!name || !css) {
      return res.status(400).json({ error: 'Name and CSS are required' });
    }
    const fileName = `${name}.json`;
    const filePath = path.join(themesDir, fileName);
    const now = new Date().toISOString();
    
    let themeData = {
      name,
      css,
      updatedAt: now
    };
    
    if (fs.existsSync(filePath)) {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      themeData.createdAt = existing.createdAt;
      // 保存历史记录
      if (!existing.history) existing.history = [];
      existing.history.push({
        css: existing.css,
        timestamp: existing.updatedAt
      });
      // 只保留最近50条历史
      if (existing.history.length > 50) {
        existing.history = existing.history.slice(-50);
      }
      themeData.history = existing.history;
    } else {
      themeData.createdAt = now;
      themeData.history = [];
    }
    
    fs.writeFileSync(filePath, JSON.stringify(themeData, null, 2), 'utf8');
    res.json({ message: 'Theme saved successfully', theme: themeData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/theme/:name', (req, res) => {
  try {
    const fileName = `${req.params.name}.json`;
    const filePath = path.join(themesDir, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Theme not found' });
    }
    fs.unlinkSync(filePath);
    res.json({ message: 'Theme deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 布局管理 API
app.get('/api/layouts', (req, res) => {
  try {
    const files = fs.readdirSync(layoutsDir);
    const layouts = files
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const filePath = path.join(layoutsDir, f);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
          name: data.name,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt
        };
      });
    res.json({ layouts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/layout/:name', (req, res) => {
  try {
    const fileName = `${req.params.name}.json`;
    const filePath = path.join(layoutsDir, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Layout not found' });
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/layout', (req, res) => {
  try {
    const { name, columns, fullscreenEnabled, fullscreenCloseOnEscape } = req.body;
    if (!name || columns === undefined) {
      return res.status(400).json({ error: 'Name and columns are required' });
    }
    const fileName = `${name}.json`;
    const filePath = path.join(layoutsDir, fileName);
    const now = new Date().toISOString();
    
    const layoutConfig = {
      columns,
      fullscreenEnabled: fullscreenEnabled !== undefined ? fullscreenEnabled : true,
      fullscreenCloseOnEscape: fullscreenCloseOnEscape !== undefined ? fullscreenCloseOnEscape : true
    };
    
    let layoutData = {
      name,
      ...layoutConfig,
      updatedAt: now
    };
    
    if (fs.existsSync(filePath)) {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      layoutData.createdAt = existing.createdAt;
      // 保存历史记录
      if (!existing.history) existing.history = [];
      existing.history.push({
        columns: existing.columns,
        fullscreenEnabled: existing.fullscreenEnabled,
        fullscreenCloseOnEscape: existing.fullscreenCloseOnEscape,
        timestamp: existing.updatedAt
      });
      // 只保留最近50条历史
      if (existing.history.length > 50) {
        existing.history = existing.history.slice(-50);
      }
      layoutData.history = existing.history;
    } else {
      layoutData.createdAt = now;
      layoutData.history = [];
    }
    
    fs.writeFileSync(filePath, JSON.stringify(layoutData, null, 2), 'utf8');
    res.json({ message: 'Layout saved successfully', layout: layoutData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/layout/:name', (req, res) => {
  try {
    const fileName = `${req.params.name}.json`;
    const filePath = path.join(layoutsDir, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Layout not found' });
    }
    fs.unlinkSync(filePath);
    res.json({ message: 'Layout deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== HTML 布局管理 API ====================
app.get('/api/html-layouts', (req, res) => {
  console.log('[API] GET /api/html-layouts 被调用');
  try {
    // 确保目录存在
    if (!fs.existsSync(htmlLayoutsDir)) {
      console.log('[API] 创建 html-layouts 目录:', htmlLayoutsDir);
      fs.mkdirSync(htmlLayoutsDir, { recursive: true });
    }
    
    let files = [];
    try {
      files = fs.readdirSync(htmlLayoutsDir);
    } catch (readErr) {
      // 如果目录不存在或读取失败，返回空数组
      console.log('[API] html-layouts 目录读取失败或为空，返回空列表');
      return res.json({ htmlLayouts: [] });
    }
    
    console.log('[API] html-layouts 目录中的文件:', files);
    // 过滤掉.deleted文件和已删除的文件
    const htmlLayouts = files
      .filter(f => f.endsWith('.json') && !f.endsWith('.deleted'))
      .map(f => {
        try {
          const filePath = path.join(htmlLayoutsDir, f);
          const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          return {
            name: data.name,
            htmlTemplate: data.htmlTemplate,
            description: data.description,
            targetKey: data.targetKey,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt
          };
        } catch (fileErr) {
          console.error(`[API] 读取文件失败: ${f}`, fileErr);
          return null;
        }
      })
      .filter(item => item !== null); // 过滤掉读取失败的文件
    console.log('[API] 返回 htmlLayouts 数量:', htmlLayouts.length);
    res.json({ htmlLayouts });
  } catch (err) {
    console.error('[API] Error loading html layouts:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/html-layout/:name', (req, res) => {
  console.log('[API] GET /api/html-layout/:name 被调用, name:', req.params.name);
  try {
    // 确保目录存在
    if (!fs.existsSync(htmlLayoutsDir)) {
      fs.mkdirSync(htmlLayoutsDir, { recursive: true });
    }
    
    const fileName = `${req.params.name}.json`;
    const filePath = path.join(htmlLayoutsDir, fileName);
    if (!fs.existsSync(filePath)) {
      console.log('[API] HTML 布局文件不存在:', filePath);
      return res.status(404).json({ error: 'HTML layout not found' });
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(data);
  } catch (err) {
    console.error('[API] Error getting html layout:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/html-layout', (req, res) => {
  console.log('[API] POST /api/html-layout 被调用');
  console.log('[API] 请求体:', { 
    name: req.body?.name, 
    hasTemplate: !!req.body?.htmlTemplate,
    description: req.body?.description,
    targetKey: req.body?.targetKey
  });
  try {
    // 确保目录存在
    if (!fs.existsSync(htmlLayoutsDir)) {
      console.log('[API] 创建 html-layouts 目录:', htmlLayoutsDir);
      fs.mkdirSync(htmlLayoutsDir, { recursive: true });
    }
    
    const { name, htmlTemplate, description, targetKey } = req.body;
    if (!name || !htmlTemplate) {
      console.log('[API] 验证失败: name 或 htmlTemplate 缺失');
      return res.status(400).json({ error: 'Name and htmlTemplate are required' });
    }
    const fileName = `${name}.json`;
    const filePath = path.join(htmlLayoutsDir, fileName);
    const now = new Date().toISOString();
    
    let htmlLayoutData = {
      name,
      htmlTemplate,
      description: description || '',
      targetKey: targetKey || 'main-layout',
      updatedAt: now
    };
    
    if (fs.existsSync(filePath)) {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      htmlLayoutData.createdAt = existing.createdAt;
      // 保存历史记录
      if (!existing.history) existing.history = [];
      existing.history.push({
        htmlTemplate: existing.htmlTemplate,
        description: existing.description,
        targetKey: existing.targetKey,
        timestamp: existing.updatedAt
      });
      // 只保留最近50条历史
      if (existing.history.length > 50) {
        existing.history = existing.history.slice(-50);
      }
      htmlLayoutData.history = existing.history;
    } else {
      htmlLayoutData.createdAt = now;
      htmlLayoutData.history = [];
    }
    
    fs.writeFileSync(filePath, JSON.stringify(htmlLayoutData, null, 2), 'utf8');
    res.json({ message: 'HTML layout saved successfully', htmlLayout: htmlLayoutData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/html-layout/:name', (req, res) => {
  console.log('[API] DELETE /api/html-layout/:name 被调用, name:', req.params.name);
  try {
    // 确保目录存在
    if (!fs.existsSync(htmlLayoutsDir)) {
      fs.mkdirSync(htmlLayoutsDir, { recursive: true });
    }
    
    const fileName = `${req.params.name}.json`;
    const filePath = path.join(htmlLayoutsDir, fileName);
    if (!fs.existsSync(filePath)) {
      console.log('[API] HTML 布局文件不存在:', filePath);
      return res.status(404).json({ error: 'HTML layout not found' });
    }
    fs.unlinkSync(filePath);
    console.log('[API] HTML 布局删除成功:', req.params.name);
    res.json({ message: 'HTML layout deleted successfully' });
  } catch (err) {
    console.error('[API] Error deleting html layout:', err);
    res.status(500).json({ error: err.message });
  }
});

// 提示词管理 API
app.get('/api/prompts', (req, res) => {
  try {
    const files = fs.readdirSync(promptsDir);
    // 过滤掉.deleted文件和已删除的文件
    const prompts = files
      .filter(f => f.endsWith('.json') && !f.endsWith('.deleted'))
      .map(f => {
        const filePath = path.join(promptsDir, f);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
          name: data.name,
          content: data.content,
          enableWorkflowControl: data.enableWorkflowControl,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt
        };
      });
    res.json({ prompts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/prompt/:name', (req, res) => {
  try {
    const fileName = `${req.params.name}.json`;
    const filePath = path.join(promptsDir, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Prompt not found' });
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/prompt', (req, res) => {
  try {
    const { name, content, enableWorkflowControl } = req.body;
    if (!name || !content) {
      return res.status(400).json({ error: 'Name and content are required' });
    }
    const fileName = `${name}.json`;
    const filePath = path.join(promptsDir, fileName);
    const now = new Date().toISOString();
    
    let promptData = {
      name,
      content,
      enableWorkflowControl: enableWorkflowControl !== undefined ? enableWorkflowControl : false, // 默认关闭
      updatedAt: now
    };
    
    if (fs.existsSync(filePath)) {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      promptData.createdAt = existing.createdAt;
      // 保存历史记录
      if (!existing.history) existing.history = [];
      existing.history.push({
        content: existing.content,
        timestamp: existing.updatedAt
      });
      // 只保留最近50条历史
      if (existing.history.length > 50) {
        existing.history = existing.history.slice(-50);
      }
      promptData.history = existing.history;
    } else {
      promptData.createdAt = now;
      promptData.history = [];
    }
    
    fs.writeFileSync(filePath, JSON.stringify(promptData, null, 2), 'utf8');
    res.json({ message: 'Prompt saved successfully', prompt: promptData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/prompt/:name', (req, res) => {
  try {
    const fileName = `${req.params.name}.json`;
    const filePath = path.join(promptsDir, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Prompt not found' });
    }
    fs.unlinkSync(filePath);
    res.json({ message: 'Prompt deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 软删除提示词（重命名添加.deleted后缀）
app.post('/api/prompt/soft-delete', (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const fileName = `${name}.json`;
    const filePath = path.join(promptsDir, fileName);
    const deletedPath = filePath + '.deleted';
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Prompt not found' });
    }
    
    // 如果已存在.deleted文件，先删除它
    if (fs.existsSync(deletedPath)) {
      fs.unlinkSync(deletedPath);
    }
    
    // 重命名文件添加.deleted后缀
    fs.renameSync(filePath, deletedPath);
    res.json({ message: 'Prompt soft deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 工作流管理 API
app.get('/api/workflows', (req, res) => {
  try {
    const files = fs.readdirSync(workflowsDir);
    const workflows = files
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const filePath = path.join(workflowsDir, f);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
          name: data.name,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt
        };
      });
    res.json({ workflows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workflow/:name', (req, res) => {
  try {
    const fileName = `${req.params.name}.json`;
    const filePath = path.join(workflowsDir, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workflow', (req, res) => {
  try {
    const { name, content, description } = req.body;
    if (!name || !content) {
      return res.status(400).json({ error: 'Name and content are required' });
    }
    const fileName = `${name}.json`;
    const filePath = path.join(workflowsDir, fileName);
    const now = new Date().toISOString();
    
    let workflowData = {
      name,
      content,
      description: description || '',
      updatedAt: now
    };
    
    if (fs.existsSync(filePath)) {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      workflowData.createdAt = existing.createdAt;
    } else {
      workflowData.createdAt = now;
    }
    
    fs.writeFileSync(filePath, JSON.stringify(workflowData, null, 2), 'utf8');
    res.json({ message: 'Workflow saved successfully', workflow: workflowData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/workflow/:name', (req, res) => {
  try {
    const fileName = `${req.params.name}.json`;
    const filePath = path.join(workflowsDir, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    fs.unlinkSync(filePath);
    res.json({ message: 'Workflow deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 事件管理 API
app.get('/api/events', (req, res) => {
  try {
    const files = fs.readdirSync(eventsDir);
    const events = files
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const filePath = path.join(eventsDir, f);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
          name: data.name,
          workflowName: data.workflowName,
          viewId: data.viewId,
          projectPath: data.projectPath,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt
        };
      });
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/event/:name', (req, res) => {
  try {
    const fileName = `${req.params.name}.json`;
    const filePath = path.join(eventsDir, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/event', (req, res) => {
  try {
    const { name, workflowName, viewId, projectPath, promptId } = req.body;
    if (!name || !workflowName) {
      return res.status(400).json({ error: 'Name and workflowName are required' });
    }
    const fileName = `${name}.json`;
    const filePath = path.join(eventsDir, fileName);
    const now = new Date().toISOString();
    
    let eventData = {
      name,
      workflowName,
      viewId: viewId || null,
      projectPath: projectPath || null,
      promptId: promptId || null,
      updatedAt: now
    };
    
    if (fs.existsSync(filePath)) {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      eventData.createdAt = existing.createdAt;
    } else {
      eventData.createdAt = now;
    }
    
    fs.writeFileSync(filePath, JSON.stringify(eventData, null, 2), 'utf8');
    res.json({ message: 'Event saved successfully', event: eventData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/event/:name', (req, res) => {
  try {
    const fileName = `${req.params.name}.json`;
    const filePath = path.join(eventsDir, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Event not found' });
    }
    fs.unlinkSync(filePath);
    res.json({ message: 'Event deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 存储当前上下文信息（由前端定期更新）
let currentContext = null;
let contextLastUpdated = null;
let contextMetadata = null; // 存储元数据：视图ID列表、文件名等

// API endpoint to save context from frontend
app.post('/api/views/context', (req, res) => {
  try {
    const { context, metadata } = req.body;
    if (!context) {
      return res.status(400).json({ error: 'Context is required' });
    }
    
    currentContext = context;
    contextLastUpdated = new Date().toISOString();
    contextMetadata = metadata || null; // 保存元数据
    
    console.log(`[Context API] 上下文已更新 - 时间: ${contextLastUpdated}`);
    console.log(`[Context API] 上下文长度: ${context.length} 字符`);
    if (contextMetadata) {
      if (contextMetadata.viewFileMap) {
        const viewFileList = Object.entries(contextMetadata.viewFileMap)
          .map(([viewId, fileName]) => `${viewId}: ${fileName}`)
          .join(', ');
        console.log(`[Context API] 视图文件映射: ${viewFileList || '无'}`);
      }
      console.log(`[Context API] 全局提示词: ${contextMetadata.globalPromptName || '无'}`);
    }
    
    res.json({ 
      message: 'Context saved successfully',
      length: context.length,
      timestamp: contextLastUpdated
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API endpoint to get current context (for external projects)
app.get('/api/views/context', (req, res) => {
  try {
    // 获取调用者IP和端口信息（多种方式尝试）
    let clientIP = req.ip || 
                   req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                   req.headers['x-real-ip'] ||
                   req.connection?.remoteAddress || 
                   req.socket?.remoteAddress || 
                   '未知';
    
    // 处理IPv6格式的IP（如果是::ffff:127.0.0.1这样的格式，提取后面的IPv4地址）
    if (clientIP && clientIP !== '未知') {
      clientIP = clientIP.replace(/^::ffff:/, '');
    }
    
    const clientPort = req.connection?.remotePort || 
                       req.socket?.remotePort || 
                       '未知';
    
    if (!currentContext) {
      console.log(`[Context API] 外部请求获取上下文 - 时间: ${new Date().toLocaleString('zh-CN')}`);
      console.log(`[Context API] 调用者IP: ${clientIP}, 端口: ${clientPort}`);
      console.log(`[Context API] 错误: 上下文不可用`);
      return res.status(404).json({ 
        error: 'Context not available',
        message: '前端尚未发送上下文信息，请确保前端应用正在运行并已加载文件'
      });
    }
    
    // 获取视图文件映射和全局提示词
    const viewFileMap = contextMetadata?.viewFileMap || {};
    const globalPromptName = contextMetadata?.globalPromptName || '无';
    
    // 构建视图ID+文件名的显示字符串
    const viewFileList = Object.entries(viewFileMap)
      .map(([viewId, fileName]) => `${viewId}: ${fileName}`)
      .join(', ');
    
    // 打印详细的调用信息
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[Context API] 外部AI请求获取上下文`);
    console.log(`  时间: ${new Date().toLocaleString('zh-CN')}`);
    console.log(`  调用者IP: ${clientIP}`);
    console.log(`  调用者端口: ${clientPort}`);
    console.log(`  视图ID+文件名: ${viewFileList || '无'}`);
    console.log(`  全局提示词: ${globalPromptName}`);
    console.log(`  上下文长度: ${currentContext.length} 字符`);
    console.log(`  上下文最后更新时间: ${contextLastUpdated}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(currentContext);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API endpoint to get context info (metadata)
app.get('/api/views/context/info', (req, res) => {
  try {
    res.json({
      available: currentContext !== null,
      length: currentContext ? currentContext.length : 0,
      lastUpdated: contextLastUpdated,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== DeepSeek AI 集成 ====================
const DEEPSEEK_USER_DATA_DIR = path.join(__dirname, 'deepseek-profile');
const DEEPSEEK_LOGIN_STATE_FILE = path.join(__dirname, 'deepseek-login-state.json');

let deepseekBrowser = null;
let deepseekPage = null;
let deepseekInitialized = false;

// 确保 deepseek-profile 目录存在
if (!fs.existsSync(DEEPSEEK_USER_DATA_DIR)) {
  fs.mkdirSync(DEEPSEEK_USER_DATA_DIR, { recursive: true });
}

// 读取登录状态
function loadLoginState() {
  try {
    if (fs.existsSync(DEEPSEEK_LOGIN_STATE_FILE)) {
      const data = fs.readFileSync(DEEPSEEK_LOGIN_STATE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('读取登录状态失败:', err);
  }
  return { loggedIn: false, lastCheck: null };
}

// 保存登录状态
function saveLoginState(loggedIn) {
  try {
    const state = {
      loggedIn: loggedIn,
      lastCheck: new Date().toISOString()
    };
    fs.writeFileSync(DEEPSEEK_LOGIN_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('保存登录状态失败:', err);
  }
}

// 初始化 DeepSeek
async function initDeepSeek() {
  if (deepseekBrowser && deepseekPage && !deepseekPage.isClosed()) {
    return;
  }

  try {
    deepseekBrowser = await puppeteer.launch({
      headless: false,
      userDataDir: DEEPSEEK_USER_DATA_DIR,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    deepseekPage = await deepseekBrowser.newPage();
    await deepseekPage.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await deepseekPage.goto('https://chat.deepseek.com', {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    await deepseekPage.waitForSelector('textarea', { timeout: 60000 });
    
    // 检查是否已登录（通过检查页面元素和登录状态文件）
    const savedState = loadLoginState();
    let isLoggedIn = false;
    
    try {
      // 等待页面加载完成
      await deepseekPage.waitForTimeout(2000);
      
      // 检查是否有 textarea（表示可以输入）
      const hasTextarea = await deepseekPage.evaluate(() => {
        return !!document.querySelector('textarea');
      });
      
      // 检查是否有登录相关的元素
      const hasLoginElements = await deepseekPage.evaluate(() => {
        const loginSelectors = [
          '[class*="login"]',
          '[class*="sign"]',
          '[id*="login"]',
          '[id*="sign"]',
          'button:contains("登录")',
          'button:contains("登录")',
          'a[href*="login"]',
          'a[href*="sign"]'
        ];
        for (const selector of loginSelectors) {
          try {
            if (document.querySelector(selector)) return true;
          } catch (e) {
            // 忽略无效选择器
          }
        }
        return false;
      });
      
      // 如果有 textarea 且没有明显的登录元素，认为已登录
      isLoggedIn = hasTextarea && !hasLoginElements;
      
      // 如果之前保存的状态是已登录，但当前检测未登录，可能需要重新登录
      if (savedState.loggedIn && !isLoggedIn) {
        console.log('⚠️ 检测到登录状态可能已失效，请检查浏览器窗口');
      }
    } catch (err) {
      console.warn('登录状态检测失败，使用保存的状态:', err.message);
      isLoggedIn = savedState.loggedIn;
    }

    if (isLoggedIn) {
      saveLoginState(true);
      console.log('✅ DeepSeek 已就绪（已登录）');
    } else {
      saveLoginState(false);
      console.log('⚠️ DeepSeek 已打开，但未检测到登录状态，请手动登录');
      console.log('   提示：登录后，下次启动将自动使用已保存的登录状态');
    }

    deepseekInitialized = true;
  } catch (err) {
    console.error('初始化 DeepSeek 失败:', err);
    deepseekInitialized = false;
    throw err;
  }
}

// 发送消息到 DeepSeek
async function sendToDeepSeek(prompt) {
  if (!prompt?.trim()) {
    throw new Error('prompt 不能为空');
  }

  try {
    await initDeepSeek();

    await deepseekPage.focus('textarea');
    await deepseekPage.evaluate((text) => {
      const textarea = document.querySelector('textarea');
      if (textarea) {
        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, prompt.trim());
    await deepseekPage.keyboard.press('Enter');

    return { success: true, message: '消息已发送' };
  } catch (err) {
    console.error('发送到 DeepSeek 失败:', err.message);
    throw err;
  }
}

// API endpoint: 发送消息到 DeepSeek
app.post('/api/deepseek/send', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt?.trim()) {
      return res.status(400).json({ error: 'prompt 不能为空' });
    }

    const result = await sendToDeepSeek(prompt);
    res.json(result);
  } catch (err) {
    console.error('❌ 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// API endpoint: 检查登录状态
app.get('/api/deepseek/status', async (req, res) => {
  try {
    const loginState = loadLoginState();
    res.json({
      initialized: deepseekInitialized,
      loggedIn: loginState.loggedIn,
      lastCheck: loginState.lastCheck
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 优雅关闭
process.on('SIGINT', async () => {
  if (deepseekBrowser) {
    await deepseekBrowser.close();
  }
  process.exit(0);
});

// API endpoint to check if access is from local
app.get('/api/check-local-access', (req, res) => {
  try {
    // 获取请求来源信息
    const host = req.get('host') || '';
    const referer = req.get('referer') || '';
    const origin = req.get('origin') || '';
    
    // 检查是否为本地访问
    // 1. 检查 Host 头是否为 localhost:2333
    const isLocalhost = host === `localhost:${port}` || host === `127.0.0.1:${port}`;
    
    // 2. 检查 Referer 或 Origin
    const isLocalReferer = referer.includes('localhost') || referer.includes('127.0.0.1');
    const isLocalOrigin = origin.includes('localhost') || origin.includes('127.0.0.1');
    
    // 3. 检查是否为内网IP（不暴露具体IP，只检查模式）
    const ipPattern = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/;
    const isLocalIP = ipPattern.test(host.split(':')[0]);
    
    // 4. 检查端口是否为 2333
    const isCorrectPort = host.endsWith(`:${port}`);
    
    // 综合判断：必须是本地地址且端口正确
    const isLocal = (isLocalhost || isLocalIP) && isCorrectPort;
    
    // 返回结果（不暴露IP信息）
    res.json({ 
      isLocal: isLocal,
      // 不返回具体IP，只返回是否为本地访问
    });
  } catch (err) {
    // 出错时默认返回false，确保安全
    res.json({ isLocal: false });
  }
});

// 日志管理 API
const logDir = path.join(__dirname, 'log');

// 确保日志目录存在
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// 写入日志条目（追加模式）
app.post('/api/log/write', (req, res) => {
  try {
    const { path: logFilePath, data } = req.body;
    if (!logFilePath || !data) {
      return res.status(400).json({ error: 'Path and data are required' });
    }
    
    const fullPath = path.join(__dirname, logFilePath);
    const dir = path.dirname(fullPath);
    
    // 确保目录存在
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // 读取现有日志（如果存在）
    let logs = [];
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        logs = JSON.parse(content);
        if (!Array.isArray(logs)) {
          logs = [];
        }
      } catch (err) {
        // 文件格式错误，重新开始
        logs = [];
      }
    }
    
    // 添加新日志条目
    logs.push({
      ...data,
      loggedAt: new Date().toISOString()
    });
    
    // 写入文件
    fs.writeFileSync(fullPath, JSON.stringify(logs, null, 2), 'utf8');
    res.json({ message: 'Log written successfully', count: logs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 读取日志数据
app.post('/api/log/read', (req, res) => {
  try {
    const { eventName, workflowName, viewId, startDate, endDate } = req.body;
    
    // 扫描所有日志文件
    const allLogs = [];
    
    // 遍历log目录下的所有年月文件夹
    if (fs.existsSync(logDir)) {
      const yearMonthDirs = fs.readdirSync(logDir).filter(item => {
        const itemPath = path.join(logDir, item);
        return fs.statSync(itemPath).isDirectory();
      });
      
      for (const yearMonth of yearMonthDirs) {
        const yearMonthPath = path.join(logDir, yearMonth);
        const logFiles = fs.readdirSync(yearMonthPath).filter(f => f.endsWith('_log.json'));
        
        for (const logFile of logFiles) {
          const logFilePath = path.join(yearMonthPath, logFile);
          try {
            const content = fs.readFileSync(logFilePath, 'utf8');
            const logs = JSON.parse(content);
            if (Array.isArray(logs)) {
              allLogs.push(...logs);
            }
          } catch (err) {
            console.error(`读取日志文件失败 ${logFilePath}:`, err);
          }
        }
      }
    }
    
    // 过滤日志
    let filteredLogs = allLogs;
    
    if (eventName) {
      filteredLogs = filteredLogs.filter(log => 
        log.type === 'event' && log.eventName === eventName
      );
    }
    
    if (workflowName) {
      filteredLogs = filteredLogs.filter(log => 
        log.workflowName === workflowName
      );
    }
    
    if (viewId) {
      filteredLogs = filteredLogs.filter(log => 
        log.viewId === viewId || (log.steps && log.steps.some(s => s.viewId === viewId))
      );
    }
    
    if (startDate) {
      filteredLogs = filteredLogs.filter(log => 
        new Date(log.timestamp) >= new Date(startDate)
      );
    }
    
    if (endDate) {
      filteredLogs = filteredLogs.filter(log => 
        new Date(log.timestamp) <= new Date(endDate)
      );
    }
    
    // 按时间戳排序（最新的在前）
    filteredLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    res.json(filteredLogs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 扫描文件系统并统计使用情况
app.post('/api/log/scan', (req, res) => {
  try {
    const { rootPath } = req.body;
    if (!rootPath) {
      return res.status(400).json({ error: 'Root path is required' });
    }
    
    const stats = {
      workflows: [],
      events: [],
      views: [],
      source: 'filesystem' // 标记数据来源
    };
    
    // 用于去重的集合
    const workflowSet = new Map();
    const eventSet = new Map();
    const viewSet = new Map();
    
    // 递归扫描目录
    function scanDirectory(dirPath, depth = 0) {
      // 限制扫描深度，避免过深
      if (depth > 10) return;
      
      try {
        if (!fs.existsSync(dirPath)) return;
        
        const items = fs.readdirSync(dirPath);
        
        for (const item of items) {
          const itemPath = path.join(dirPath, item);
          const stat = fs.statSync(itemPath);
          
          if (stat.isDirectory()) {
            // 递归扫描子目录
            scanDirectory(itemPath, depth + 1);
          } else if (stat.isFile()) {
            // 检查是否为步骤文件（格式：时间戳_文件名_视图名.扩展名）
            // 时间戳格式：2024-01-01T12-00-00 或 2024-01-01_12-00-00
            const timestampPattern = /^(\d{4}-\d{2}-\d{2}[T_]\d{2}-\d{2}-\d{2})_(.+)_(.+)\.(md|txt)$/;
            const match = item.match(timestampPattern);
            
            if (match) {
              const [, timestamp, baseName, viewId] = match;
              
              // 统计视图使用
              const key = `${viewId}_${baseName}`;
              if (!viewSet.has(key)) {
                viewSet.set(key, {
                  viewId: viewId,
                  baseName: baseName,
                  count: 0,
                  firstUsed: null,
                  lastUsed: null,
                  files: []
                });
              }
              
              const viewStat = viewSet.get(key);
              viewStat.count++;
              const fileTime = fs.statSync(itemPath).mtime;
              if (!viewStat.firstUsed || fileTime < viewStat.firstUsed) {
                viewStat.firstUsed = fileTime;
              }
              if (!viewStat.lastUsed || fileTime > viewStat.lastUsed) {
                viewStat.lastUsed = fileTime;
              }
              viewStat.files.push({
                path: itemPath,
                timestamp: timestamp,
                baseName: baseName,
                mtime: fileTime
              });
            }
            
            // 检查是否为合并文件（格式：事件名:文件名）
            const eventPattern = /^(.+):(.+)$/;
            const eventMatch = item.match(eventPattern);
            
            if (eventMatch) {
              const [, eventName, fileName] = eventMatch;
              
              // 统计事件使用
              if (!eventSet.has(eventName)) {
                eventSet.set(eventName, {
                  eventName: eventName,
                  count: 0,
                  firstUsed: null,
                  lastUsed: null,
                  files: []
                });
              }
              
              const eventStat = eventSet.get(eventName);
              eventStat.count++;
              const fileTime = fs.statSync(itemPath).mtime;
              if (!eventStat.firstUsed || fileTime < eventStat.firstUsed) {
                eventStat.firstUsed = fileTime;
              }
              if (!eventStat.lastUsed || fileTime > eventStat.lastUsed) {
                eventStat.lastUsed = fileTime;
              }
              eventStat.files.push({
                path: itemPath,
                fileName: fileName,
                mtime: fileTime
              });
            }
          }
        }
      } catch (err) {
        console.error(`扫描目录失败 ${dirPath}:`, err);
      }
    }
    
    // 开始扫描
    scanDirectory(rootPath);
    
    // 转换为数组并格式化日期
    stats.workflows = Array.from(workflowSet.values()).map(w => ({
      ...w,
      firstUsed: w.firstUsed ? w.firstUsed.toISOString() : null,
      lastUsed: w.lastUsed ? w.lastUsed.toISOString() : null
    }));
    stats.events = Array.from(eventSet.values()).map(e => ({
      ...e,
      firstUsed: e.firstUsed ? e.firstUsed.toISOString() : null,
      lastUsed: e.lastUsed ? e.lastUsed.toISOString() : null
    }));
    stats.views = Array.from(viewSet.values()).map(v => ({
      ...v,
      firstUsed: v.firstUsed ? v.firstUsed.toISOString() : null,
      lastUsed: v.lastUsed ? v.lastUsed.toISOString() : null
    }));
    
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取统计配置
app.get('/api/log/config', (req, res) => {
  try {
    const configPath = path.join(__dirname, 'log-config.json');
    let config = {
      scanEnabled: false,
      scanInterval: 2 // 小时
    };
    
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      config = { ...config, ...JSON.parse(content) };
    }
    
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 保存统计配置
app.post('/api/log/config', (req, res) => {
  try {
    const { scanEnabled, scanInterval } = req.body;
    const config = {
      scanEnabled: scanEnabled !== undefined ? scanEnabled : false,
      scanInterval: scanInterval !== undefined ? scanInterval : 2
    };
    
    const configPath = path.join(__dirname, 'log-config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    
    res.json({ message: 'Config saved successfully', config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 在启动前验证 HTML 布局 API 路由已注册
console.log('========================================');
console.log('服务器启动 - 验证 API 路由');
console.log('HTML 布局 API 路由:');
console.log('  - GET  /api/html-layouts');
console.log('  - GET  /api/html-layout/:name');
console.log('  - POST /api/html-layout');
console.log('  - DELETE /api/html-layout/:name');
console.log('htmlLayoutsDir:', htmlLayoutsDir);
console.log('========================================');

app.listen(port, () => {
  console.log(`文件查看器应用正在运行`);
  // 不暴露端口和API端点信息
});