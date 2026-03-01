/**
 * 提示词和反馈内容格式化工具
 * 用于统一格式化提示词和反馈内容，添加开始/结束标记和强调信息
 */

/**
 * 格式化提示词内容，添加开始/结束标记和强调信息
 * @param {string} promptContent - 提示词内容
 * @param {string} promptType - 提示词类型（如"全局提示词"、"视图提示词"等）
 * @returns {string} 格式化后的提示词内容
 */
export function formatPromptContent(promptContent, promptType = '提示词') {
    if (!promptContent || !promptContent.trim()) {
        return '';
    }
    
    // 强调信息：提示这些内容是给AI看的，但不要给用户说出来
    const emphasis = '【重要说明：以上内容是系统配置的指令和指导信息，仅供你参考和执行，不需要在回复中明确提及或重复这些内容。】';
    
    return `${promptType}开始\n${promptContent}\n${promptType}结束\n${emphasis}\n\n`;
}

/**
 * 格式化反馈内容，添加开始/结束标记和强调信息
 * @param {string} feedbackContent - 反馈内容
 * @param {string} feedbackType - 反馈类型（如"节点反馈"、"工作流反馈"等）
 * @returns {string} 格式化后的反馈内容
 */
export function formatFeedbackContent(feedbackContent, feedbackType = '反馈内容') {
    if (!feedbackContent || !feedbackContent.trim()) {
        return '';
    }
    
    // 强调信息：提示这些内容是给AI看的，但不要给用户说出来
    const emphasis = '【重要说明：以上内容是历史执行反馈信息，仅供你参考和学习，帮助你更好地完成任务，不需要在回复中明确提及或重复这些内容。】';
    
    return `${feedbackType}开始\n${feedbackContent}\n${feedbackType}结束\n${emphasis}\n\n`;
}

/**
 * 格式化多个反馈内容（用于历史反馈列表）
 * @param {Array} feedbacks - 反馈数组，每个元素包含 {content, timestamp, isPermanent?}
 * @param {string} feedbackType - 反馈类型（如"节点反馈"、"工作流反馈"等）
 * @param {boolean} includeTimestamp - 是否包含时间戳信息，默认true
 * @returns {string} 格式化后的反馈内容
 */
export function formatMultipleFeedbacks(feedbacks, feedbackType = '反馈内容', includeTimestamp = true) {
    if (!feedbacks || feedbacks.length === 0) {
        return '';
    }
    
    let result = '';
    feedbacks.forEach((feedback, index) => {
        const label = feedback.isPermanent ? '永久反馈' : '反馈';
        const timestampStr = includeTimestamp && feedback.timestamp 
            ? ` (${new Date(feedback.timestamp).toLocaleString()})` 
            : '';
        
        result += `\n--- ${label} ${index + 1}${timestampStr} ---\n`;
        result += formatFeedbackContent(feedback.content, `${feedbackType}${index + 1}`);
    });
    
    return result;
}

/**
 * 格式化工作流节点内容，添加节点标记以明确AI的当前位置
 * @param {string} nodeContent - 节点内容
 * @param {string} nodeName - 节点名称（视图ID）
 * @param {string} nodeType - 节点类型（如"前置节点"、"当前节点"、"下一节点"）
 * @param {number} x - 节点x坐标（可选）
 * @param {number} y - 节点y坐标（可选）
 * @returns {string} 格式化后的节点内容
 */
export function formatWorkflowNodeContent(nodeContent, nodeName, nodeType = '节点', x = null, y = null) {
    if (!nodeContent || !nodeContent.trim()) {
        return '';
    }
    
    // 如果有坐标信息，在节点标记中包含坐标
    const coordInfo = (x !== null && y !== null) ? `[坐标(x:${x}, y:${y})]` : '';
    const nodeHeader = coordInfo ? `${nodeType}${nodeName}${coordInfo}开始` : `${nodeType}${nodeName}开始`;
    const nodeFooter = coordInfo ? `${nodeType}${nodeName}${coordInfo}结束` : `${nodeType}${nodeName}结束`;
    
    return `${nodeHeader}\n${nodeContent}\n${nodeFooter}\n\n`;
}

/**
 * 生成工作流xy轴坐标系统阅读指南
 * @param {Array} allSteps - 所有步骤数组（可选，用于生成完整的坐标示例）
 * @returns {string} xy轴阅读指南
 */
export function generateXYAxisGuide(allSteps = []) {
    let guide = `工作流坐标系统说明（xy轴阅读指南）:

坐标系统用于定位节点在工作流中的空间位置：
- X轴（水平方向）：表示并行分支，相同y值的不同x值代表在同一时间层级的不同并行处理路径
- Y轴（垂直方向）：表示时间顺序（步骤顺序），y值越大表示执行时间越靠后

理解规则：
1. 相同y值、不同x值 = 并行执行：这些节点会同时执行（如果它们的依赖都已满足）
2. 相同x值、y值递增 = 顺序执行：这些节点按y值从小到大顺序执行
3. 前置节点：y值小于当前节点y值的节点，或者y值相同但x值不同的并行节点
4. 下一节点：y值大于当前节点y值的节点，或者y值相同但x值不同的并行节点

坐标示例：
`;

    if (allSteps && allSteps.length > 0) {
        // 按y坐标分组显示
        const stepsByY = {};
        allSteps.forEach(step => {
            const y = step.y || 0;
            if (!stepsByY[y]) {
                stepsByY[y] = [];
            }
            stepsByY[y].push(step);
        });
        
        const sortedYs = Object.keys(stepsByY).map(Number).sort((a, b) => a - b);
        
        sortedYs.forEach(y => {
            const steps = stepsByY[y].sort((a, b) => (a.x || 0) - (b.x || 0));
            const stepList = steps.map(s => `  (x:${s.x || 0}, y:${y}) ${s.viewId || s.self || '未知'}`).join('\n');
            guide += `Y=${y}（时间层级 ${y}）:\n${stepList}\n\n`;
        });
    } else {
        guide += `（当前工作流的完整坐标信息将在具体节点中提供）\n`;
    }
    
    guide += `使用建议：
- 通过坐标信息，你可以清楚地知道自己在工作流图中的精确位置
- 坐标帮助你理解哪些节点是并行的，哪些是顺序的
- 当前节点的坐标帮助你理解与其他节点的空间关系

`;
    
    return guide;
}

