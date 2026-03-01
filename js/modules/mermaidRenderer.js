/**
 * Mermaid图表渲染模块
 * 负责Mermaid图表的渲染、全屏显示和缩放平移
 */

/**
 * 渲染Mermaid图表
 */
export function renderMdDiagrams(container) {
    if (!container || !window.mermaid) return;

    const blocks = container.querySelectorAll(
        "pre > code.language-mermaid, pre > code.lang-mermaid"
    );

    blocks.forEach(code => {
        const pre = code.parentElement;
        if (!pre || pre.dataset.rendered === "1") return;
        pre.dataset.rendered = "1";

        const src = code.textContent || "";

        // 外层卡片
        const wrapper = document.createElement("div");
        wrapper.className = "md-diagram";
        wrapper.setAttribute("data-md-diagram-source", src);

        // 顶部标题栏
        const header = document.createElement("div");
        header.className = "md-diagram-header";
        header.textContent = "Mermaid 图表";
        wrapper.appendChild(header);

        // 全屏按钮
        const fullBtn = document.createElement("button");
        fullBtn.className = "diagram-fullscreen-btn";
        fullBtn.textContent = "<";
        fullBtn.onclick = (e) => {
            e.stopPropagation();
            showDiagramFullscreen(wrapper);
        };
        wrapper.appendChild(fullBtn);

        // Mermaid图形容器
        const chart = document.createElement("div");
        chart.className = "mermaid";
        chart.textContent = src;
        chart.dataset.mdDiagramSource = src;
        wrapper.appendChild(chart);

        // 添加点击事件
        chart.style.cursor = 'pointer';
        chart.onclick = () => showDiagramFullscreen(wrapper);
        
        wrapper.style.cursor = 'pointer';
        wrapper.onclick = (e) => {
            if (e.target === fullBtn || fullBtn.contains(e.target)) return;
            if (e.target === chart || chart.contains(e.target)) return;
            showDiagramFullscreen(wrapper);
        };

        // 替换原来的pre
        pre.replaceWith(wrapper);

        // 渲染图表
        try {
            window.mermaid.init(undefined, chart);
        } catch (err) {
            console.error("Mermaid 渲染失败:", err);
        }
    });
}

/**
 * 全屏显示图表
 */
export function showDiagramFullscreen(diagramEl) {
    const modal = document.getElementById('fullscreen-modal');
    const body = document.getElementById('fullscreen-body');
    if (!modal || !body) return;
    
    body.innerHTML = '';

    const src =
        diagramEl.getAttribute('data-md-diagram-source') ||
        (diagramEl.querySelector('.mermaid')?.dataset.mdDiagramSource) ||
        (diagramEl.querySelector('.mermaid')?.textContent) ||
        "";

    const wrapper = document.createElement("div");
    wrapper.className = "md-diagram md-diagram-fullscreen";
    wrapper.style.cssText = 'display: flex; flex-direction: column; width: 100%; height: 100%; overflow: hidden;';

    const chart = document.createElement("div");
    chart.className = "mermaid";
    chart.textContent = src;
    chart.dataset.mdDiagramSource = src;
    chart.style.cssText = 'flex: 1; display: flex; align-items: center; justify-content: center; overflow: auto; cursor: grab; position: relative;';

    wrapper.appendChild(chart);
    body.appendChild(wrapper);
    modal.style.display = 'flex';

    if (window.mermaid) {
        try {
            window.mermaid.init(undefined, chart);
            addZoomPanFunctionality(chart);
        } catch (err) {
            console.error("Mermaid 全屏渲染失败:", err);
        }
    }
}

/**
 * 添加缩放和平移功能
 */
function addZoomPanFunctionality(chartElement) {
    let isPanning = false;
    let startX, startY;
    let transform = {
        x: 0,
        y: 0,
        scale: 1
    };

    chartElement.style.userSelect = 'none';
    chartElement.style.cursor = 'grab';
    chartElement.style.transformOrigin = 'center center';

    function applyTransformToSvg() {
        const svgElement = chartElement.querySelector('svg');
        if (svgElement) {
            svgElement.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
            svgElement.style.transformOrigin = '0 0';
            svgElement.style.transition = 'none';
        }
    }

    function setupZoomPanForSvg() {
        const svgElement = chartElement.querySelector('svg');
        if (!svgElement) {
            setTimeout(setupZoomPanForSvg, 100);
            return;
        }

        svgElement.style.width = '100%';
        svgElement.style.height = '100%';

        // 鼠标按下
        chartElement.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
            isPanning = true;
            startX = e.clientX - transform.x;
            startY = e.clientY - transform.y;
            chartElement.style.cursor = 'grabbing';
        });

        // 鼠标抬起
        chartElement.addEventListener('mouseup', () => {
            isPanning = false;
            chartElement.style.cursor = 'grab';
        });

        // 鼠标移动
        chartElement.addEventListener('mousemove', (e) => {
            if (!isPanning) return;
            transform.x = e.clientX - startX;
            transform.y = e.clientY - startY;
            applyTransformToSvg();
        });

        // 鼠标滚轮缩放
        chartElement.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomIntensity = 0.1;
            const rect = chartElement.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const svgRect = svgElement.getBoundingClientRect();
            const svgX = mouseX - svgRect.left + chartElement.scrollLeft;
            const svgY = mouseY - svgRect.top + chartElement.scrollTop;

            const relX = (svgX - transform.x) / transform.scale;
            const relY = (svgY - transform.y) / transform.scale;

            if (e.deltaY < 0) {
                transform.scale = Math.min(transform.scale + zoomIntensity, 5);
            } else {
                transform.scale = Math.max(transform.scale - zoomIntensity, 0.1);
            }

            transform.x = svgX - relX * transform.scale;
            transform.y = svgY - relY * transform.scale;

            applyTransformToSvg();
        });

        applyTransformToSvg();
    }

    setupZoomPanForSvg();
}

// 暴露到全局
if (typeof window !== 'undefined') {
    window.renderMdDiagrams = renderMdDiagrams;
    window.showDiagramFullscreen = showDiagramFullscreen;
}
