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
        // 【新增：获取用户设置的加载数量】
        const extSettings = getExtensionSettings()[EXTENSION_NAME] || {};
        const limitVal = extSettings.itemLimit || '150'; // 默认 150

        // 基础查询
        let query = supabase.from("fragments").select("*").order("created_at", { ascending: false });
        
        // 如果不是选了“全部”，就加上数量限制
        if (limitVal !== 'all') {
            query = query.limit(parseInt(limitVal, 10));
        }
        
        if (currentFilter !== 'all') {
            query = query.eq('type', currentFilter);
        } else {
            query = query.in('type', ['role_card', 'beautify']);
        }

        const { data, error } = await query;
        if (error) throw error;

        allFetchedItems = (data || []).map(item => {
            item._parsed = {};
            try {
                if (item.content && item.content.startsWith('{')) {
                    item._parsed = JSON.parse(item.content);
                } else {
                    item._parsed.name = item.content;
                }
            } catch(e){}
            
            let tags = [];
            if (item.category) {
                tags = item.category.replace(/，/g, ",").split(/[, \s]+/).filter(t => t && t.trim().length > 0);
            }
            item._parsed.tags = tags;
            
            return item;
        });

        currentSelectedTag = '';
        $('#museum-search-input').val(currentSearchQuery);
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

// ====== 新增：一键抓取并上传主题功能 (手机端特化防弹版) ======
async function handleAutoCaptureTheme() {
    if (!supabase || !session) {
        toast.error("请先在设置中连接并登录 Supabase");
        return;
    }

    const themeCategory = prompt("给主题打上标签 (空格隔开, 直接点确定表示不加标签)：", "自用 主题");
    if (themeCategory === null) return; 

    const $btn = $('#museum-auto-capture-theme');
    const originalText = $btn.html();
    $btn.html('<i class="fa-solid fa-spinner fa-spin"></i> 正在生成官方主题文件...').css('pointer-events', 'none');

    try {
        // ==========================================
        // 1. 终极拦截：直接从内存“偷取” Blob 数据 (100% 解决手机端 Failed to fetch)
        // ==========================================
        const { blob: jsonBlob, downloadName: fileName } = await new Promise((resolve, reject) => {
            const originalCreateElement = document.createElement.bind(document);
            const originalCreateObjectURL = URL.createObjectURL.bind(URL);
            
            let timeout;
            let stolenBlob = null; // 用于存放偷取到的内存文件
            
            function cleanup() {
                document.createElement = originalCreateElement;
                URL.createObjectURL = originalCreateObjectURL;
                clearTimeout(timeout);
            }

            // 【核心黑科技】酒馆导出文件必定会经过 URL.createObjectURL
            // 我们在这里拦截，直接把生成的 Blob 原文件扣下来！完全不需要发送 fetch 网络请求！
            URL.createObjectURL = function(obj) {
                if (obj instanceof Blob) {
                    stolenBlob = obj;
                }
                return originalCreateObjectURL.apply(this, arguments);
            };

            // 拦截 <a> 标签的点击动作
            document.createElement = function(tagName) {
                const el = originalCreateElement(tagName);
                if (tagName.toLowerCase() === 'a') {
                    el.click = function() {
                        const downloadName = this.download;
                        cleanup(); 
                        if (stolenBlob) {
                            resolve({ blob: stolenBlob, downloadName });
                        } else {
                            reject(new Error("未能成功拦截到主题数据。"));
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
        // 2. 截图聊天界面 (手机端特化优化)
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

        // 判断是否为移动端
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        const $hiddenElements = $('.drawer, #top-bar, #toast-container, #movingDivs');
        $hiddenElements.hide(); 
        
        // 给点时间让界面重绘
        await new Promise(r => setTimeout(r, 500)); 

        let imgBlob;
        try {
            // 【手机端特化】如果是在手机上，只截图 #chat 聊天框，不截全屏
            const targetElement = isMobile ? (document.getElementById('chat') || document.body) : document.body;

            const canvasOptions = {
                useCORS: true,
                allowTaint: false,
                backgroundColor: null,
                scale: isMobile ? 1 : (window.devicePixelRatio || 1), // 手机强制 1 倍分辨率防 OOM
                logging: false,
                onclone: (clonedDoc) => {
                    // 1. 隐藏多余 UI
                    clonedDoc.querySelectorAll('.drawer, #top-bar, #toast-container, #movingDivs').forEach(el => {
                        el.style.setProperty('display', 'none', 'important');
                    });

                    // 2. 移除模糊滤镜，防止 html2canvas 报错透明
                    const fixStyle = clonedDoc.createElement('style');
                    fixStyle.innerHTML = `* { backdrop-filter: none !important; }`;
                    clonedDoc.head.appendChild(fixStyle);

                    // ========================================================
                    // 3. 【核心修复】洗白所有 html2canvas 不支持的高级 CSS 颜色函数 (支持无限嵌套)
                    // ========================================================
                    const sanitizeCSSColors = (cssText) => {
                        if (!cssText) return cssText;
                        const keywords = ['color', 'color-mix', 'lab', 'lch', 'oklab', 'oklch', 'hwb'];
                        let result = cssText;
                        for (const kw of keywords) {
                            // 匹配关键字 (忽略大小写)
                            const regex = new RegExp('\\b' + kw + '\\s*\\(', 'gi');
                            let match;
                            // 使用 while 循环逐个替换，确保无限次嵌套也能被正确消除
                            while ((match = regex.exec(result)) !== null) {
                                let startIdx = match.index;
                                let openBrackets = 0;
                                let endIdx = -1;
                                
                                // 从关键字后的第一个 '(' 开始寻找对应的 ')'
                                let bracketStart = result.indexOf('(', startIdx);
                                if (bracketStart === -1) break;

                                for (let i = bracketStart; i < result.length; i++) {
                                    if (result[i] === '(') openBrackets++;
                                    if (result[i] === ')') {
                                        openBrackets--;
                                        if (openBrackets === 0) {
                                            endIdx = i;
                                            break;
                                        }
                                    }
                                }
                                
                                if (endIdx !== -1) {
                                    // 找到成对的括号，将整个不受支持的函数替换为安全灰色
                                    result = result.substring(0, startIdx) + 'rgba(128, 128, 128, 0.5)' + result.substring(endIdx + 1);
                                    regex.lastIndex = 0; // 重置正则，防止字符串长度变化导致匹配漏掉
                                } else {
                                    break; // 括号不匹配（语法错误的情况），强行跳出避免死循环
                                }
                            }
                        }
                        return result;
                    };

                    // 清洗所有的 <style> 标签
                    clonedDoc.querySelectorAll('style').forEach(style => {
                        if (style.innerHTML) {
                            style.innerHTML = sanitizeCSSColors(style.innerHTML);
                        }
                    });

                    // 清洗所有 DOM 元素的行内样式 (直接修改 attribute 更底层，防止浏览器自作聪明)
                    clonedDoc.querySelectorAll('*').forEach(el => {
                        const styleAttr = el.getAttribute('style');
                        if (styleAttr) {
                            el.setAttribute('style', sanitizeCSSColors(styleAttr));
                        }
                    });

                    // 4. 处理图片跨域与占位符问题
                    if (isMobile) {
                        // 【手机端终极防护】强行把所有图片替换成透明占位符，阻断外网图片请求防卡死
                        const dummyImg = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
                        clonedDoc.querySelectorAll('img').forEach(img => {
                            img.src = dummyImg;
                            img.style.backgroundColor = 'var(--SmartThemeQuoteColor, #cccccc)';
                        });
                        clonedDoc.querySelectorAll('[style*="background-image"]').forEach(el => {
                            el.style.backgroundImage = 'none';
                            el.style.backgroundColor = 'var(--SmartThemeQuoteColor, #cccccc)';
                        });
                    } else {
                        // 【PC端】依然走图床代理路线保留原图
                        clonedDoc.querySelectorAll('[style*="background-image"]').forEach(el => {
                            if (el.style && el.style.backgroundImage && el.style.backgroundImage.includes('url(')) {
                                el.style.backgroundImage = el.style.backgroundImage.replace(/url\(['"]?(https?:\/\/[^'")]+)['"]?\)/gi, (match, imgUrl) => {
                                    if (imgUrl.includes(location.host) || imgUrl.includes('wsrv.nl')) return match;
                                    return `url('https://wsrv.nl/?url=${encodeURIComponent(imgUrl)}')`;
                                });
                            }
                        });
                    }
                }
            };


            // 如果是手机端，限制最大高度为当前屏幕高度，防止聊天记录过长撑爆内存
            if (isMobile) {
                canvasOptions.height = Math.min(targetElement.scrollHeight, window.innerHeight);
                canvasOptions.windowHeight = window.innerHeight;
            }

            const canvas = await html2canvas(targetElement, canvasOptions);
            imgBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            
            if (imgBlob.size < 10000) {
                throw new Error("截取到了无效的透明图片。");
            }
            
        } catch (err) {
            console.error(err);
            throw new Error("截图失败: " + err.message);
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
        
        const imgName = `beautify_prev_${timestamp}_${rand}.png`;
        const jsonName = `beautify_file_${timestamp}_${rand}.json`;

        try {
            const { error: imgErr } = await supabase.storage.from('uploads').upload(imgName, imgBlob);
            if (imgErr) throw imgErr;
        } catch (err) {
            throw new Error("上传图片至云端失败: " + err.message);
        }
        const imgUrl = supabase.storage.from('uploads').getPublicUrl(imgName).data.publicUrl;

        try {
            const { error: jsonErr } = await supabase.storage.from('uploads').upload(jsonName, jsonBlob);
            if (jsonErr) throw jsonErr;
        } catch (err) {
            throw new Error("上传JSON至云端失败: " + err.message);
        }
        const jsonUrl = supabase.storage.from('uploads').getPublicUrl(jsonName).data.publicUrl;

        // ==========================================
        // 4. 写入数据库
        // ==========================================
        const contentObj = {
            title: themeName,
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
        if (dbErr) throw new Error("数据库写入失败: " + dbErr.message);

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





function createSettingsHtml() {
    const settings = getExtensionSettings()[EXTENSION_NAME] || {};
    
    return `
    <div id="${EXTENSION_ID}" class="inline-drawer wide100p flexFlowColumn">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b><i class="fa-solid fa-building-columns"></i> 博物馆 (Museum)</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>

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

            <!-- 【新增：加载数量选择框】 -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 5px;">
                <span style="font-size: 0.8em; opacity: 0.8;">加载数量:</span>
                <select id="museum-item-limit" class="text_pole" style="width: auto; padding: 2px 5px; height: 28px; border-radius: 4px;">
                    <option value="50" ${settings.itemLimit === '50' ? 'selected' : ''}>50 项</option>
                    <option value="150" ${(!settings.itemLimit || settings.itemLimit === '150') ? 'selected' : ''}>150 项</option>
                    <option value="300" ${settings.itemLimit === '300' ? 'selected' : ''}>300 项</option>
                    <option value="500" ${settings.itemLimit === '500' ? 'selected' : ''}>500 项</option>
                    <option value="all" ${settings.itemLimit === 'all' ? 'selected' : ''}>全部 (可能卡顿)</option>
                </select>
            </div>

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


function initializePlugin() {
    console.log("[Museum] 初始化...");

    const settings = getExtensionSettings();
    if (settings && !settings[EXTENSION_NAME]) {
        // 加入 itemLimit 默认参数
        settings[EXTENSION_NAME] = { sbUrl: "", sbKey: "", sbEmail: "", sbPass: "", itemLimit: "150" };
        saveExtensionSettings();
    }

    const targetContainer = document.getElementById('extensions_settings');
    const secondaryContainer = document.getElementById('extensions_settings2');
    
    if (document.getElementById(EXTENSION_ID)) return;

    injectStyles();

    const html = createSettingsHtml();
    
    if (secondaryContainer) {
        secondaryContainer.insertAdjacentHTML('beforeend', html);
    } else if (targetContainer) {
        targetContainer.insertAdjacentHTML('beforeend', html);
    } else {
        console.error("[Museum] 找不到扩展面板容器 (#extensions_settings)");
    }

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
    
    // 【新增】监听加载数量下拉框改变
    $('#museum-item-limit').on('change', function() {
        const extSettings = getExtensionSettings()[EXTENSION_NAME];
        extSettings.itemLimit = $(this).val(); // 保存当前选中的值
        saveExtensionSettings();               // 写入本地存储
        
        // 切换数量后，清空搜索和标签状态并重新加载
        currentSearchQuery = '';
        currentSelectedTag = '';
        $('#museum-search-input').val('');
        refreshGallery();
    });

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

    let hasLoadedGallery = false;
    $(`#${EXTENSION_ID} .inline-drawer-toggle`).on('click', function() {
        if (!hasLoadedGallery) {
            hasLoadedGallery = true;
            
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


