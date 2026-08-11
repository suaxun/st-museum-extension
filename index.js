// 扩展名称和常量
const EXTENSION_NAME = "museum_importer";
const EXTENSION_ID = "museum-extension-root"; // 唯一的 DOM ID

// 全局变量
let supabase = null;
let session = null;
let currentFilter = 'all';
let keepAliveTimer = null; 
// 【新增：用于搜索和标签过滤的变量】
let allFetchedItems = []; // 缓存当前分类下的所有数据
let currentSearchQuery = ''; // 当前搜索词
let currentSelectedTag = ''; // 当前选中的标签
// --- 核心工具函数 ---

// 获取 ST 上下文
const getContext = () => {
    return window.SillyTavern && window.SillyTavern.getContext ? window.SillyTavern.getContext() : null;
}

// 获取扩展设置
function getExtensionSettings() {
    const context = getContext();
    if (context && context.extensionSettings) {
        return context.extensionSettings;
    }
    if (window.extension_settings) {
        return window.extension_settings;
    }
    return {};
}

// 保存设置
function saveExtensionSettings() {
    const context = getContext();
    if (context && context.saveSettingsDebounced) {
        context.saveSettingsDebounced();
    }
}

// 通用 Toast 通知
const toast = {
    success: (msg) => window.toastr ? window.toastr.success(msg) : console.log("[Museum] " + msg),
    error: (msg) => window.toastr ? window.toastr.error(msg) : console.error("[Museum] " + msg),
    info: (msg) => window.toastr ? window.toastr.info(msg) : console.log("[Museum] " + msg),
    warning: (msg) => window.toastr ? window.toastr.warning(msg) : console.warn("[Museum] " + msg)
};

// --- 样式注入 (修复图片高度自适应) ---
function injectStyles() {
    if ($('#museum-extension-styles').length) return;

    const css = `
        /* === 网格布局 === */
        .museum-grid {
            display: grid;
            gap: 12px;
            padding: 10px 0;
            width: 100%;
            /* 移动端默认: 3 列 */
            grid-template-columns: repeat(3, 1fr);
            /* 【核心修改】顶部对齐，允许卡片高度不一致（瀑布流效果取决于列宽，非真正瀑布流但不再拉伸） */
            align-items: start;
        }

        /* PC端 (宽度大于800px): 2 列 */
        @media (min-width: 800px) {
            .museum-grid {
                grid-template-columns: repeat(2, 1fr);
            }
        }

        /* === 卡片基础样式 === */
        .museum-item {
            background-color: var(--SmartThemeBgColor);
            border: 1px solid var(--SmartThemeBorderColor);
            border-radius: 8px;
            overflow: hidden;
            position: relative; 
            display: flex;
            flex-direction: column;
            transition: all 0.2s ease;
            /* 【核心修改】高度完全自适应内容 */
            height: auto; 
            box-shadow: 0 2px 5px rgba(0,0,0,0.05);
        }
        
        .museum-item:hover {
            border-color: var(--SmartThemeQuoteColor);
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }

        /* === 图片容器 === */
        .museum-thumb-container {
            width: 100%;
            /* 【核心修改】移除 aspect-ratio 和固定高度 */
            height: auto; 
            flex-shrink: 0;
            background-color: rgba(0,0,0,0.05);
            position: relative;
            overflow: hidden;
            border-bottom: 1px solid var(--SmartThemeBorderColor);
            /* 消除图片底部的微小空隙 */
            display: flex; 
        }

        .museum-preview-img {
            width: 100%;
            /* 【核心修改】高度自动，保持原图比例 */
            height: auto; 
            display: block;
            transition: transform 0.5s ease;
        }
        
        .museum-item:hover .museum-preview-img {
            transform: scale(1.05); 
        }

        .museum-type-tag {
            position: absolute;
            top: 6px;
            right: 6px;
            background: rgba(0,0,0,0.6);
            color: #fff;
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 4px;
            backdrop-filter: blur(2px);
            z-index: 2;
            pointer-events: none;
        }

        /* === 底部信息区 === */
        .museum-info {
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            background-color: var(--SmartThemeBgColor);
            z-index: 2;
            /* 移除 flex-grow，让其紧贴图片下方 */
        }

        .museum-title {
            font-size: 0.95em;
            font-weight: bold;
            color: var(--SmartThemeBodyColor);
            /* 允许标题换行，防止撑破布局 */
            white-space: normal;
            word-break: break-all;
            line-height: 1.3;
        }

        /* 按钮组 */
        .museum-btn-group {
            display: flex;
            gap: 6px;
            margin-top: 5px;
        }

        .museum-action-btn {
            background-color: var(--SmartThemeQuoteColor);
            color: var(--SmartThemeBodyColor);
            text-align: center;
            padding: 6px 0;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
            flex: 1;
            transition: opacity 0.2s;
            border: 1px solid transparent;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            font-weight: 500;
        }
        .museum-action-btn:hover {
            opacity: 0.85;
            filter: brightness(1.1);
        }
        
        .museum-action-btn.secondary {
            background-color: transparent;
            border: 1px solid var(--SmartThemeBorderColor);
            color: var(--SmartThemeBodyColor);
            flex: 0 0 32px; /* 方形按钮 */
        }
        .museum-action-btn.secondary:hover {
            border-color: var(--SmartThemeQuoteColor);
            color: var(--SmartThemeQuoteColor);
            background-color: rgba(128,128,128,0.05);
        }

        /* === 内部覆盖层 (详情/历史) === */
        /* 修改覆盖层逻辑：因为父容器高度不固定，绝对定位可能会溢出或不足 */
        /* 但为了覆盖效果，我们仍保持 absolute full size */
        .museum-card-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: var(--SmartThemeBgColor);
            z-index: 10;
            display: flex;
            flex-direction: column;
            transform: translateY(100%);
            transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
            padding: 0;
            box-sizing: border-box;
        }
        .museum-card-overlay.active {
            transform: translateY(0);
        }

        /* 覆盖层头部 */
        .museum-overlay-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 12px;
            border-bottom: 1px solid var(--SmartThemeBorderColor);
            background-color: rgba(0,0,0,0.03);
            flex-shrink: 0;
        }
        .museum-overlay-title {
            font-size: 0.9em;
            font-weight: bold;
            color: var(--SmartThemeBodyColor);
        }
        .museum-overlay-close {
            cursor: pointer;
            padding: 4px;
            opacity: 0.6;
            transition: opacity 0.2s;
        }
        .museum-overlay-close:hover { opacity: 1; color: var(--SmartThemeQuoteColor); }

        /* 覆盖层内容滚动区 */
        .museum-overlay-body {
            flex-grow: 1;
            overflow-y: auto;
            padding: 12px;
            font-size: 0.85em;
            color: var(--SmartThemeBodyColor);
            scrollbar-width: thin;
            scrollbar-color: var(--SmartThemeQuoteColor) transparent;
        }
        .museum-overlay-body::-webkit-scrollbar { width: 4px; }
        .museum-overlay-body::-webkit-scrollbar-thumb { background: var(--SmartThemeQuoteColor); border-radius: 2px; }

        /* 角色简介 */
        .museum-role-desc {
            margin-bottom: 15px;
            line-height: 1.5;
            opacity: 0.9;
            white-space: pre-wrap;
            padding-bottom: 10px;
            border-bottom: 1px dashed var(--SmartThemeBorderColor);
        }

        /* 迷你时间轴列表 */
        .museum-mini-timeline {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .timeline-label {
            font-size: 0.8em;
            opacity: 0.6;
            margin-bottom: 5px;
            font-weight: bold;
            text-transform: uppercase;
        }

        .museum-version-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px;
            background: rgba(128,128,128,0.05);
            border-radius: 6px;
            border: 1px solid var(--SmartThemeBorderColor);
            transition: background 0.2s;
        }
        .museum-version-row:hover {
            background: rgba(128,128,128,0.1);
        }
        
        .museum-version-info {
            display: flex;
            flex-direction: column;
            overflow: hidden;
            margin-right: 5px;
        }
        .museum-v-date { 
            font-weight: bold; 
            font-size: 0.9em; 
            color: var(--SmartThemeBodyColor);
        }
        .museum-v-note { 
            font-size: 0.8em; 
            opacity: 0.7; 
            white-space: nowrap; 
            overflow: hidden; 
            text-overflow: ellipsis; 
            max-width: 100%;
        }
        
        .museum-v-btn {
            font-size: 0.8em;
            padding: 4px 10px;
            background: var(--SmartThemeBgColor);
            border: 1px solid var(--SmartThemeBorderColor);
            color: var(--SmartThemeBodyColor);
            border-radius: 4px;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.2s;
        }
        .museum-v-btn:hover {
            background: var(--SmartThemeQuoteColor);
            border-color: var(--SmartThemeQuoteColor);
            color: var(--SmartThemeBodyColor); 
        }

        /* 美化颜色点 */
        .museum-color-dots {
            display: flex;
            gap: 5px;
            overflow-x: auto;
            padding-bottom: 4px;
            margin-bottom: 2px;
        }
        .color-dot {
            width: 14px;
            height: 14px;
            border-radius: 50%;
            border: 1px solid rgba(128,128,128,0.3);
            cursor: pointer;
            flex-shrink: 0;
            transition: transform 0.2s;
        }
        .color-dot:hover {
            transform: scale(1.2);
        }
        
        /* 旋转动画 */
        .fa-spin { animation: fa-spin 2s infinite linear; }
        @keyframes fa-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    `;
    $('head').append(`<style id="museum-extension-styles">${css}</style>`);
}
async function keepAliveSupabase() {
    if (!supabase) return;
    try {
        // 请求最少的数据，只查 1 条数据的 ID，极低消耗
        await supabase.from("fragments").select("id").limit(1);
        console.log("[Museum] Supabase 后台保活请求已发送，防止账号被暂停");
    } catch (e) {
        console.warn("[Museum] Supabase 保活请求失败:", e.message);
    }
}

function startKeepAlive() {
    // 如果已经有定时器，先清除，防止重复
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    
    // 【核心修改】进入登录状态时，立刻发送一次保活请求！
    keepAliveSupabase(); 
    
    // 之后如果你一直没关网页，它会每隔 12 小时继续发一次保活请求
    keepAliveTimer = setInterval(() => {
        keepAliveSupabase();
    }, 12 * 60 * 60 * 1000); 
    
    console.log("[Museum] Supabase 保活机制已启动 (已立即执行首次请求)");
}


// --- Supabase 逻辑 (保持不变) ---
async function loadSupabase() {
    if (window.supabase) return;
    const sources = [
        "https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js",
        "https://cdnjs.cloudflare.com/ajax/libs/supabase.js/2.39.7/supabase.min.js",
        "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.8/dist/umd/supabase.min.js"
    ];
    console.log("[Museum] 正在加载 Supabase SDK...");
    const tryLoadScript = (url) => {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = () => resolve();
            script.onerror = () => { document.head.removeChild(script); reject(); };
            document.head.appendChild(script);
        });
    };
    for (const url of sources) {
        try { await tryLoadScript(url); return; } catch (e) { continue; }
    }
    if (window.toastr) window.toastr.error("无法加载 Supabase 组件");
}

async function initSupabaseClient() {
    const settings = getExtensionSettings()[EXTENSION_NAME];
    if (!settings || !settings.sbUrl || !settings.sbKey) return false;
    if (!window.supabase) await loadSupabase();
    try {
        const createClient = window.supabase.createClient || window.supabase.default.createClient;
        supabase = createClient(settings.sbUrl, settings.sbKey);
        const { data } = await supabase.auth.getSession();
        if (data.session) {
            session = data.session;
            startKeepAlive(); // 【新增】连接成功，启动保活
            return true;
        } else if (settings.sbEmail && settings.sbPass) {
            return await doLogin();
        }
        return false;
    } catch (e) {
        console.error("[Museum] Supabase Init Error:", e);
        return false;
    }
}


async function doLogin() {
    if (!supabase) return false;
    const settings = getExtensionSettings()[EXTENSION_NAME];
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: settings.sbEmail,
            password: settings.sbPass
        });
        if (error) throw error;
        session = data.session;
        toast.success("博物馆登录成功");
        
        startKeepAlive(); // 【新增】登录成功，启动保活
        
        return true;
    } catch (e) {
        toast.error("登录失败: " + e.message);
        return false;
    }
}

// --- 数据获取与渲染 ---

async function refreshGallery() {
    const grid = $('#museum-grid');
    grid.empty();
    $('#museum-tag-container').empty(); // 清空标签
    grid.append('<div class="museum-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading...</div>');

    const success = await initSupabaseClient();
    
    if (!success || !session) {
        grid.html('<div style="text-align:center; padding:20px; font-size:0.8em; opacity:0.7;">未连接。<br>请点击上方齿轮图标配置并登录。</div>');
        return;
    }

try {
    // 【修改】加上 .limit(100) 或者你觉得合适的值。
    // 如果后续数据多，建议做分页，但这里先加一个硬上限防止手机卡死。
    let query = supabase.from("fragments").select("*").order("created_at", { ascending: false }).limit(150);
    
    if (currentFilter !== 'all') {
            query = query.eq('type', currentFilter);
        } else {
            query = query.in('type', ['role_card', 'beautify']);
        }

        const { data, error } = await query;
        if (error) throw error;

        // 【修改核心】将获取的数据预解析，并存入全局缓存 allFetchedItems
        allFetchedItems = (data || []).map(item => {
            item._parsed = {};
            try {
                if (item.content && item.content.startsWith('{')) {
                    item._parsed = JSON.parse(item.content);
                } else {
                    item._parsed.name = item.content;
                }
            } catch(e){}
            
            // 【修复关键】：标签实际上存在数据库的 category 字段里
            let tags = [];
            if (item.category) {
                // 兼容中文逗号、英文逗号、空格分割
                tags = item.category.replace(/，/g, ",").split(/[, \s]+/).filter(t => t && t.trim().length > 0);
            }
            item._parsed.tags = tags;
            
            return item;
        });


        // 每次重新获取数据时，重置状态并触发渲染
        currentSelectedTag = '';
        $('#museum-search-input').val(currentSearchQuery); // 保持搜索词
        applyFiltersAndRender();

    } catch (e) {
        toast.error("获取失败: " + e.message);
        grid.html('<div style="text-align:center; padding:20px;">加载失败</div>');
    }
}
// ====== 请把下面这段代码插入到 refreshGallery() 和 renderItems() 之间 ======

// --- 本地过滤与渲染分发 ---
function applyFiltersAndRender() {
    let filtered = allFetchedItems;

    // 1. 关键词搜索过滤 (匹配名字、标题、描述、标签)
    if (currentSearchQuery) {
        const q = currentSearchQuery.toLowerCase();
        filtered = filtered.filter(item => {
            const p = item._parsed;
            const textToSearch = `${p.name||''} ${p.title||''} ${p.description||''} ${(p.tags||[]).join(' ')}`.toLowerCase();
            return textToSearch.includes(q);
        });
    }

    // 2. 提取当前过滤结果中所有的有效标签
    const tagSet = new Set();
    filtered.forEach(item => {
        if (item._parsed && item._parsed.tags) {
            item._parsed.tags.forEach(t => tagSet.add(t));
        }
    });
    const availableTags = Array.from(tagSet).sort();

    // 3. 标签匹配过滤
    if (currentSelectedTag) {
        // 如果当前选中的标签因为搜索被过滤掉了，就取消选中
        if (!availableTags.includes(currentSelectedTag)) {
            currentSelectedTag = '';
        } else {
            filtered = filtered.filter(item => item._parsed && item._parsed.tags && item._parsed.tags.includes(currentSelectedTag));
        }
    }

    // 4. 更新界面
    renderTags(availableTags);
    renderItems(filtered);
}

// --- 渲染顶部标签条 ---
function renderTags(tags) {
    const container = $('#museum-tag-container');
    container.empty();
    
    if (tags.length === 0) return;

    tags.forEach(tag => {
        const isActive = tag === currentSelectedTag ? 'active' : '';
        const $btn = $(`<div class="museum-tag ${isActive}">${tag}</div>`);
        
        $btn.on('click', () => {
            // 点击标签：如果已选中则取消，如果未选中则选中
            if (currentSelectedTag === tag) {
                currentSelectedTag = ''; 
            } else {
                currentSelectedTag = tag; 
            }
            applyFiltersAndRender();
        });
        
        container.append($btn);
    });
}

// ====== 插入结束 ======


// 格式化时间辅助函数
const formatDateShort = (ts) => {
    if (!ts) return '未知';
    const d = new Date(ts);
    return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
};

function renderItems(items) {
    const grid = $('#museum-grid');
    grid.empty();

    if (items.length === 0) {
        grid.html('<div style="text-align:center; padding:20px; opacity: 0.7; color: var(--SmartThemeBodyColor);">暂无内容</div>');
        return;
    }

    items.forEach(item => {
        // --- 数据解析 ---
        let title = "未命名";
        let typeLabel = "未知";
        let imgUrl = "";
        let variations = [];
        let description = "";
        let history = [];
        
        if (item.type === 'role_card') {
            typeLabel = "角色";
            try {
                if (item.content.startsWith('{')) {
                    const json = JSON.parse(item.content);
                    title = json.name || "未命名";
                    description = json.description || "暂无简介";
                    history = json.history || [];
                    
                    // 如果历史记录为空但有 file_url，构造初始记录
                    if (history.length === 0 && item.file_url) {
                        history.push({
                            date: item.created_at,
                            png: item.file_url,
                            note: "初始版本"
                        });
                    }
                } else {
                    title = item.content;
                }
                imgUrl = item.file_url;
            } catch (e) { title = item.content; }
        } 
        else if (item.type === 'beautify') {
            typeLabel = "美化";
            try {
                const json = JSON.parse(item.content);
                title = json.title || "主题";
                variations = json.variations || [];
                if (variations.length > 0) {
                    imgUrl = variations[0].preview || item.file_url;
                }
            } catch (e) { }
        }

        // --- 构建 HTML ---

        // 1. 卡片主体
        let colorDotsHtml = '';
        if (item.type === 'beautify' && variations.length > 0) {
            colorDotsHtml = '<div class="museum-color-dots">';
            variations.forEach((v, idx) => {
                colorDotsHtml += `<div class="color-dot" data-idx="${idx}" title="${v.name}" style="background-color: ${v.color};"></div>`;
            });
            colorDotsHtml += '</div>';
        }

        // 角色卡的“详情”按钮
        const detailBtn = item.type === 'role_card' 
            ? `<div class="museum-action-btn secondary toggle-overlay-btn" title="查看详情与历史版本"><i class="fa-solid fa-list-ul"></i></div>` 
            : '';
        let tagsHtml = '';
        if (item._parsed && item._parsed.tags && item._parsed.tags.length > 0) {
            tagsHtml = '<div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:2px; margin-bottom:2px;">';
            item._parsed.tags.forEach(t => {
                tagsHtml += `<span style="font-size:0.7em; opacity:0.7; border:1px solid currentColor; padding:0 4px; border-radius:4px; cursor:pointer;" onclick="$('#museum-search-input').val('${t}').trigger('input');">#${t}</span>`;
            });
            tagsHtml += '</div>';
        }
        const cardHtml = `
            <div class="museum-item" data-id="${item.id}">
                <!-- 正面内容 -->
                <div class="museum-thumb-container">
                    <img class="museum-preview-img" src="${imgUrl}" loading="lazy">
                    <div class="museum-type-tag">${typeLabel}</div>
                </div>

                <div class="museum-info">
                    <div class="museum-title" title="${title}">${title}</div>
                    ${tagsHtml}
                    ${colorDotsHtml}
                    <div class="museum-selected-idx" data-idx="0"></div>
                    
                    <div class="museum-btn-group">
                        <div class="museum-action-btn import-btn">
                            <i class="fa-solid fa-download"></i> 导入
                        </div>
                        ${detailBtn}
                    </div>
                </div>

                <!-- 内部覆盖层 (角色卡专用) -->
                ${item.type === 'role_card' ? `
                <div class="museum-card-overlay">
                    <div class="museum-overlay-header">
                        <span class="museum-overlay-title"><i class="fa-solid fa-clock-rotate-left"></i> 档案记录</span>
                        <div class="museum-overlay-close toggle-overlay-btn"><i class="fa-solid fa-xmark"></i></div>
                    </div>
                    <div class="museum-overlay-body">
                        <div class="museum-role-desc">${description}</div>
                        
                        <div class="timeline-label">历史版本</div>
                        <div class="museum-mini-timeline"></div>
                    </div>
                </div>` : ''}
            </div>
        `;
        
        const $card = $(cardHtml);

        // --- 事件绑定 ---

        // 1. 美化包颜色切换
        if (item.type === 'beautify') {
            $card.find('.color-dot').on('click', function(e) {
                e.stopPropagation();
                const idx = $(this).data('idx');
                const selectedVar = variations[idx];
                $card.find('.color-dot').css({'border-color': 'rgba(128,128,128,0.3)', 'transform': 'scale(1)'});
                $(this).css({'border-color': 'var(--SmartThemeQuoteColor)', 'transform': 'scale(1.2)'});
                
                if (selectedVar && selectedVar.preview) {
                    $card.find('.museum-preview-img').attr('src', selectedVar.preview);
                }
                $card.find('.museum-selected-idx').data('idx', idx);
            });
        }

        // 2. 角色卡覆盖层切换
        if (item.type === 'role_card') {
            const overlay = $card.find('.museum-card-overlay');
            const timelineContainer = overlay.find('.museum-mini-timeline');

            // 渲染历史列表
            history.forEach((ver, idx) => {
                const isLatest = idx === 0;
                const rowHtml = `
                    <div class="museum-version-row">
                        <div class="museum-version-info">
                            <span class="museum-v-date">${formatDateShort(ver.date)} ${isLatest ? '<span style="color:#4caf50; font-size:0.8em; margin-left:4px;">NEW</span>' : ''}</span>
                            <span class="museum-v-note" title="${ver.note || ''}">${ver.note || '无说明'}</span>
                        </div>
                        <button class="museum-v-btn history-import-btn" data-url="${ver.png || ver.json}">
                            导入
                        </button>
                    </div>
                `;
                timelineContainer.append(rowHtml);
            });

            // 详情按钮开关
            $card.find('.toggle-overlay-btn').on('click', function(e) {
                e.stopPropagation();
                overlay.toggleClass('active');
            });

            // 历史记录导入按钮
            $card.find('.history-import-btn').on('click', function(e) {
                e.stopPropagation();
                const url = $(this).data('url');
                const btn = $(this);
                handleHistoryImport(url, title, btn);
            });
        }

        // 3. 主导入按钮 (导入最新/默认)
        $card.find('.import-btn').on('click', function(e) {
            e.stopPropagation(); 
            handleImport(item, $card);
        });
        
        grid.append($card);
    });
}

// --- 导入逻辑 ---

async function handleImport(item, $card) {
    if (item.type === 'role_card') {
        const btn = $card.find('.import-btn');
        const originalHtml = btn.html();
        btn.html('<i class="fa-solid fa-spinner fa-spin"></i>');
        
        try {
            // 解析获取最新名字
            let charName = "character";
            try {
                const json = JSON.parse(item.content);
                if (json.name) charName = json.name;
            } catch(e) {}

            await performCharacterImport(item.file_url, charName);
            btn.html('<i class="fa-solid fa-check"></i>');
        } catch (e) {
            btn.html('<i class="fa-solid fa-xmark"></i>');
        }
        setTimeout(() => btn.html(originalHtml), 2000);

    } else if (item.type === 'beautify') {
        await importBeautifyDirectly(item, $card);
    }
}

// 历史版本导入
async function handleHistoryImport(url, charName, $btn) {
    const originalText = $btn.text();
    $btn.html('<i class="fa-solid fa-spinner fa-spin"></i>');
    
    try {
        await performCharacterImport(url, charName);
        $btn.html('<i class="fa-solid fa-check"></i>');
    } catch (e) {
        $btn.html('<i class="fa-solid fa-xmark"></i>');
    }
    setTimeout(() => $btn.text(originalText), 2000);
}

// 核心 ST 导入逻辑
async function performCharacterImport(url, charName) {
    try {
        if (!url) throw new Error("无效的文件链接");

        const res = await fetch(url);
        if (!res.ok) throw new Error(`下载失败: ${res.status}`);
        const blob = await res.blob();

        let ext = 'png';
        if (blob.type.includes('json') || url.endsWith('.json')) ext = 'json';
        
        const cleanName = (charName || 'character').replace(/[^a-zA-Z0-9\u4e00-\u9fa5-_]/g, '_');
        const filename = `${cleanName}.${ext}`;
        const file = new File([blob], filename, { type: blob.type });

        const stImportInput = document.getElementById('character_import_file');
        
        if (!stImportInput) throw new Error("找不到角色导入组件");

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        stImportInput.files = dataTransfer.files;

        const changeEvent = new Event('change', { bubbles: true });
        stImportInput.dispatchEvent(changeEvent);

        toast.success(`正在导入: ${charName}`);

    } catch (e) {
        console.error(e);
        toast.error(`导入失败: ${e.message}`);
        throw e;
    }
}

async function importBeautifyDirectly(item, $card) {
    const btn = $card.find('.import-btn');
    const originalText = btn.html();
    
    try {
        const selectedIdx = $card.find('.museum-selected-idx').data('idx') || 0;
        const json = JSON.parse(item.content);
        const variations = json.variations || [];
        const selectedVar = variations[selectedIdx];

        if (!selectedVar || !selectedVar.file) {
            throw new Error("此配色方案没有有效的源文件链接");
        }

        const themeUrl = selectedVar.file;
        // 【确保导入时恢复中文名字】
        const themeName = json.title || selectedVar.name || "自定义主题";

        btn.html('<i class="fa-solid fa-spinner fa-spin"></i>');

        const response = await fetch(themeUrl);
        if (!response.ok) throw new Error(`网络请求失败`);
        
        const blob = await response.blob();
        
        // 允许中文，仅过滤操作系统不允许的符号
        const fileName = `${themeName.replace(/[\\/:*?"<>|]/g, '_')}.json`;
        const file = new File([blob], fileName, { type: "application/json" });

        const stThemeInput = document.getElementById('ui_preset_import_file');
        if (!stThemeInput) throw new Error("找不到 ST 主题导入组件");

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        stThemeInput.files = dataTransfer.files;

        const changeEvent = new Event('change', { bubbles: true });
        stThemeInput.dispatchEvent(changeEvent);

        toast.success(`主题 "${themeName}" 已导入`);
        btn.html('<i class="fa-solid fa-check"></i>');
        
    } catch (e) {
        console.error(e);
        toast.error("导入失败: " + e.message);
        btn.html('<i class="fa-solid fa-xmark"></i>');
    }
    setTimeout(() => btn.html(originalText), 2000);
}


// ====== 新增：一键抓取并上传主题功能 (终极拦截防销毁版) ======
async function handleAutoCaptureTheme() {
    if (!supabase || !session) {
        toast.error("请先在设置中连接并登录 Supabase");
        return;
    }

    const themeCategory = prompt("给主题打上标签 (空格隔开，直接点确定表示不加标签)：", "自用 主题");
    if (themeCategory === null) return; 

    const $btn = $('#museum-auto-capture-theme');
    const originalText = $btn.html();
    $btn.html('<i class="fa-solid fa-spinner fa-spin"></i> 正在生成官方主题文件...').css('pointer-events', 'none');

    try {
        // ==========================================
        // 1. 终极拦截：同时拦截 <a> 标签和 URL.revokeObjectURL
        // ==========================================
        const { blob: jsonBlob, downloadName: fileName } = await new Promise((resolve, reject) => {
            const originalCreateElement = document.createElement.bind(document);
            const originalRevoke = URL.revokeObjectURL.bind(URL);
            
            let timeout;
            
            // 清理劫持，恢复原状
            function cleanup() {
                document.createElement = originalCreateElement;
                URL.revokeObjectURL = originalRevoke;
                clearTimeout(timeout);
            }

            // 【关键修复】拦截酒馆的“自毁代码”！让文件多活10秒钟供我们读取
            URL.revokeObjectURL = function(url) {
                setTimeout(() => originalRevoke(url), 10000); 
            };

            // 拦截 <a> 标签的下载动作
            document.createElement = function(tagName) {
                const el = originalCreateElement(tagName);
                if (tagName.toLowerCase() === 'a') {
                    // 覆盖原生 click 行为，只拦截链接，不真的下载到用户电脑上
                    el.click = async function() {
                        const href = this.href;
                        const downloadName = this.download;
                        cleanup(); // 拿到东西就立刻恢复原状
                        
                        try {
                            // 因为我们拦截了销毁，这里 fetch 绝对不会再报错了
                            const res = await fetch(href);
                            const blob = await res.blob();
                            resolve({ blob, downloadName });
                        } catch (err) {
                            reject(err);
                        }
                    };
                }
                return el;
            };

            // 悄悄触发酒馆官方的导出按钮
            const exportBtn = document.getElementById('ui_preset_export_button');
            if (exportBtn) {
                exportBtn.click();
            } else {
                cleanup();
                reject(new Error("找不到酒馆的原生导出按钮"));
            }

            // 超时保护
            timeout = setTimeout(() => {
                cleanup();
                reject(new Error("读取官方导出文件超时"));
            }, 3000);
        });

        // 提取主题名字（去掉 .json 后缀）
        let themeName = fileName.replace(/\.json$/i, '');
        // ==========================================
        // 2. 截图当前聊天界面 (使用专门的图片 CDN 代理洗白跨域限制)
        // ==========================================
        $btn.html('<i class="fa-solid fa-camera fa-spin"></i> 正在截取聊天预览图...');
        toast.info("正在抓取界面，请稍候...", 2000);
        
        if (!window.html2canvas) {
            await new Promise((res, rej) => {
                const script = document.createElement('script');
                script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
                script.onload = res;
                script.onerror = rej;
                document.head.appendChild(script);
            });
        }

const $hiddenElements = $('.drawer, #top-bar, #toast-container, #movingDivs');
$hiddenElements.hide(); 
        
        // 给点时间让界面重绘
        await new Promise(r => setTimeout(r, 500)); 

        let imgBlob;
        try {
           const canvas = await html2canvas(document.body, {
    useCORS: true,           
    allowTaint: false,       
    backgroundColor: null,   
    // 【修改】检测如果是 iOS 设备，强制设为 1。因为只做预览图，1 完全足够了，能省下几倍的内存。
    scale: /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 1 : (window.devicePixelRatio || 1),
    logging: false,
                onclone: (clonedDoc) => {
                    // 1. 隐藏多余 UI
                    clonedDoc.querySelectorAll('.drawer, #top-bar, #toast-container, #movingDivs').forEach(el => {
                        el.style.setProperty('display', 'none', 'important');
                    });

                    // 2. 移除所有高斯模糊 (html2canvas不支持模糊，遇到模糊必透明或报错)
                    const fixStyle = clonedDoc.createElement('style');
                    fixStyle.innerHTML = `* { backdrop-filter: none !important; }`;
                    clonedDoc.head.appendChild(fixStyle);

                    // 3. 【黑科技】强行洗白 <style> 里的图床链接
                    // 使用 wsrv.nl 这个强大的图片代理CDN，它会自动处理跨域头并返回图片
                    const styles = clonedDoc.querySelectorAll('style');
                    styles.forEach(style => {
                        if (style.innerHTML && style.innerHTML.includes('url(')) {
                            style.innerHTML = style.innerHTML.replace(/url\(['"]?(https?:\/\/[^'")]+)['"]?\)/gi, (match, imgUrl) => {
                                // 已经是本地路径或已被代理，不处理
                                if (imgUrl.includes(location.host) || imgUrl.includes('wsrv.nl')) return match;
                                // 替换为图片代理
                                return `url('https://wsrv.nl/?url=${encodeURIComponent(imgUrl)}')`;
                            });
                        }
                    });

// 4. 洗白所有行内样式里的图床链接
// 【修改】只遍历带有 style 属性的元素，极大减少遍历耗时
clonedDoc.querySelectorAll('[style*="background-image"]').forEach(el => {
    if (el.style && el.style.backgroundImage && el.style.backgroundImage.includes('url(')) {
        el.style.backgroundImage = el.style.backgroundImage.replace(/url\(['"]?(https?:\/\/[^'")]+)['"]?\)/gi, (match, imgUrl) => {
            if (imgUrl.includes(location.host) || imgUrl.includes('wsrv.nl')) return match;
            return `url('https://wsrv.nl/?url=${encodeURIComponent(imgUrl)}')`;
        });
    }
});
                }
            });

            imgBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            
            // 如果截出来是全透明(小于10KB)，说明安全限制太死，抛出错误
            if (imgBlob.size < 10000) {
                throw new Error("截取到了无效的透明图片。");
            }
            
        } catch (err) {
            console.error(err);
            throw new Error("截图失败: " + err.message + " \n(建议将CSS中的图床图片存到酒馆本地 public/user/images 中)");
        } finally {
            $hiddenElements.show(); 
        }




        // ==========================================
        // 3. 上传到 Supabase 存储桶
        // ==========================================
        $btn.html('<i class="fa-solid fa-cloud-arrow-up fa-spin"></i> 正在上传至云端...');

        const uid = session.user.id;
        const timestamp = Date.now();
        const rand = Math.random().toString(36).substr(2, 5);
        
        // 这里的云端地址必须是纯英文，防止报错
        const imgName = `beautify_prev_${timestamp}_${rand}.png`;
        const jsonName = `beautify_file_${timestamp}_${rand}.json`;

        const { error: imgErr } = await supabase.storage.from('uploads').upload(imgName, imgBlob);
        if (imgErr) throw imgErr;
        const imgUrl = supabase.storage.from('uploads').getPublicUrl(imgName).data.publicUrl;

        const { error: jsonErr } = await supabase.storage.from('uploads').upload(jsonName, jsonBlob);
        if (jsonErr) throw jsonErr;
        const jsonUrl = supabase.storage.from('uploads').getPublicUrl(jsonName).data.publicUrl;

        // ==========================================
        // 4. 写入数据库
        // ==========================================
        const contentObj = {
            title: themeName, // 标题保持完美的中文名
            variations: [
                {
                    name: "主配色",
                    color: "#ffffff", 
                    preview: imgUrl,
                    file: jsonUrl
                }
            ]
        };

        const payload = {
            type: 'beautify',
            category: themeCategory ? themeCategory.trim() : "快捷抓取",
            content: JSON.stringify(contentObj),
            file_url: imgUrl, 
            user_id: uid
        };

        const { error: dbErr } = await supabase.from('fragments').insert(payload);
        if (dbErr) throw dbErr;

        toast.success(`🎉 主题 "${themeName}" 已成功上传！`);
        
        currentFilter = 'beautify';
        $('.museum-filter-btn').removeClass('active');
        $(`[data-filter='beautify']`).addClass('active');
        refreshGallery();

    } catch (e) {
        console.error("[Museum Capture Error]", e);
        toast.error("抓取/上传失败: " + e.message);
        $('.drawer, #top-bar, #toast-container, #movingDivs').show();
    } finally {
        $btn.html(originalText).css('pointer-events', 'auto');
    }
}
// ====== 修改结束 ======





// --- 界面创建 ---
function createSettingsHtml() {
    const settings = getExtensionSettings()[EXTENSION_NAME] || {};
    
    return `
    <div id="${EXTENSION_ID}" class="inline-drawer wide100p flexFlowColumn">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b><i class="fa-solid fa-building-columns"></i> 博物馆 (Museum)</b>
            <!-- 【修复】使用 down 代表默认折叠状态 -->
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>

        <!-- 【修复】加上 style="display: none;" 彻底让它默认关闭，拯救 iOS -->
        <div class="inline-drawer-content museum-drawer-content" style="display: none;">
            <div class="flex-container">
                <div class="menu_button fa-solid fa-arrows-rotate" id="museum-refresh-btn" title="刷新"></div>
                <div class="menu_button fa-solid fa-gear" id="museum-config-toggle" title="设置"></div>
            </div>

            <div id="museum-auth-panel" class="museum-auth-box" style="display:none;">
                <small>Supabase 连接配置</small>
                <input type="text" id="museum-sb-url" class="text_pole textarea_compact" placeholder="Supabase URL" value="${settings.sbUrl || ''}">
                <input type="password" id="museum-sb-key" class="text_pole textarea_compact" placeholder="Supabase Key" value="${settings.sbKey || ''}">
                <input type="text" id="museum-email" class="text_pole textarea_compact" placeholder="Email" value="${settings.sbEmail || ''}">
                <input type="password" id="museum-pass" class="text_pole textarea_compact" placeholder="Password" value="${settings.sbPass || ''}">
                <button id="museum-save-btn" class="menu_button" style="width:100%; margin-top:5px;">保存并登录</button>
            </div>

            <div class="museum-filter-bar">
                <div class="museum-filter-btn active" data-filter="all">全部</div>
                <div class="museum-filter-btn" data-filter="role_card">角色</div>
                <div class="museum-filter-btn" data-filter="beautify">美化</div>
            </div>

            <button id="museum-auto-capture-theme" class="menu_button" style="width: 100%; margin-top: 5px; background-color: var(--SmartThemeQuoteColor); color: var(--SmartThemeBgColor);">
                <i class="fa-solid fa-camera"></i> 一键抓取当前主题入库
            </button>

            <!-- 搜索框 -->
            <input type="text" id="museum-search-input" class="text_pole museum-search-box" placeholder="输入名称、描述或标签搜索...">
            
            <!-- 标签容器 -->
            <div id="museum-tag-container" class="museum-tags"></div>

            <div id="museum-grid" class="museum-grid">
                <div style="grid-column:1/-1; text-align:center; padding:20px; opacity:0.5; font-size:0.8em;">
                    正在加载博物馆内容...
                </div>
            </div>
        </div>
    </div>
    `;
}


// --- 初始化逻辑 ---
function initializePlugin() {
    console.log("[Museum] 初始化...");

    const settings = getExtensionSettings();
    if (settings && !settings[EXTENSION_NAME]) {
        settings[EXTENSION_NAME] = { sbUrl: "", sbKey: "", sbEmail: "", sbPass: "" };
        saveExtensionSettings();
    }

    const targetContainer = document.getElementById('extensions_settings');
    const secondaryContainer = document.getElementById('extensions_settings2');
    
    if (document.getElementById(EXTENSION_ID)) return;

    // 注入 CSS 样式
    injectStyles();

    const html = createSettingsHtml();
    
    if (secondaryContainer) {
        secondaryContainer.insertAdjacentHTML('beforeend', html);
    } else if (targetContainer) {
        targetContainer.insertAdjacentHTML('beforeend', html);
    } else {
        console.error("[Museum] 找不到扩展面板容器 (#extensions_settings)");
    }

    // 绑定事件
    $('#museum-config-toggle').on('click', () => $('#museum-auth-panel').slideToggle());
    $('#museum-auto-capture-theme').on('click', handleAutoCaptureTheme);

    $('#museum-save-btn').on('click', async () => {
        const extSettings = getExtensionSettings()[EXTENSION_NAME];
        extSettings.sbUrl = $('#museum-sb-url').val().trim();
        extSettings.sbKey = $('#museum-sb-key').val().trim();
        extSettings.sbEmail = $('#museum-email').val().trim();
        extSettings.sbPass = $('#museum-pass').val().trim();
        
        saveExtensionSettings();
        
        const success = await initSupabaseClient();
        if (success) {
            $('#museum-auth-panel').slideUp();
            refreshGallery();
        }
    });

    $('#museum-refresh-btn').on('click', refreshGallery);
    
    let searchTimeout;
    $('#museum-search-input').on('input', function() {
        clearTimeout(searchTimeout);
        const val = $(this).val().trim();
        searchTimeout = setTimeout(() => {
            currentSearchQuery = val;
            applyFiltersAndRender();
        }, 300);
    });

    $('.museum-filter-btn').off('click').on('click', function() {
        $('.museum-filter-btn').removeClass('active');
        $(this).addClass('active');
        currentFilter = $(this).data('filter');
        
        currentSearchQuery = '';
        currentSelectedTag = '';
        $('#museum-search-input').val('');
        
        refreshGallery();
    });

    // 【完美修复】IOS崩溃关键：懒加载机制
    let hasLoadedGallery = false;
    // 监听酒馆原生下拉面板的点击事件
    $(`#${EXTENSION_ID} .inline-drawer-toggle`).on('click', function() {
        // 如果该区域尚未加载数据
        if (!hasLoadedGallery) {
            hasLoadedGallery = true; // 标记为已加载
            
            // 开始懒加载数据库
            loadSupabase().then(() => {
                const s = getExtensionSettings()[EXTENSION_NAME];
                if (s && s.sbUrl && s.sbKey) {
                    initSupabaseClient().then(() => {
                        if (session) refreshGallery();
                    });
                } else {
                    $('#museum-grid').html('<div style="text-align:center; padding:20px; font-size:0.8em; opacity:0.7;">未配置数据库。<br>请点击上方齿轮图标配置。</div>');
                }
            });
        }
    });

    console.log("[Museum] 初始化完成");
}

// --- 启动器 ---
(function () {
    const waitForSillyTavernContext = () => {
        const context = getContext();
        if (context && context.eventSource && context.eventTypes) {
            context.eventSource.once(context.eventTypes.APP_READY, () => {
                setTimeout(initializePlugin, 500);
            });
        } else {
            setTimeout(waitForSillyTavernContext, 100);
        }
    };

    waitForSillyTavernContext();
})();


