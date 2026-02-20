// 扩展名称和常量
const EXTENSION_NAME = "museum_importer";
const EXTENSION_ID = "museum-extension-root"; // 唯一的 DOM ID

// 全局变量
let supabase = null;
let session = null;
let currentFilter = 'all';

// --- 核心工具函数 ---

// 获取 ST 上下文
const getContext = () => {
    return window.SillyTavern && window.SillyTavern.getContext ? window.SillyTavern.getContext() : null;
}

// 获取扩展设置（安全版）
function getExtensionSettings() {
    const context = getContext();
    if (context && context.extensionSettings) {
        return context.extensionSettings;
    }
    // 回退兼容
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

// --- Supabase 逻辑 (保持不变，因为这部分没问题) ---

async function loadSupabase() {
    if (window.supabase) return;
    
    console.log("[Museum] Loading Supabase SDK...");
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.8/dist/umd/supabase.min.js";
        script.onload = () => {
            console.log("[Museum] Supabase SDK Loaded.");
            resolve();
        };
        script.onerror = (e) => {
            console.error("[Museum] Failed to load Supabase SDK", e);
            reject(e);
        };
        document.head.appendChild(script);
    });
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
        return true;
    } catch (e) {
        toast.error("登录失败: " + e.message);
        return false;
    }
}

// --- 数据获取与渲染 (保持不变) ---

async function refreshGallery() {
    const grid = $('#museum-grid');
    grid.empty();
    grid.append('<div class="museum-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading...</div>');

    const success = await initSupabaseClient();
    
    if (!success || !session) {
        grid.html('<div style="text-align:center; padding:20px; font-size:0.8em; opacity:0.7;">未连接。<br>请点击上方齿轮图标配置并登录。</div>');
        return;
    }

    try {
        let query = supabase.from("fragments").select("*").order("created_at", { ascending: false });
        
        if (currentFilter !== 'all') {
            query = query.eq('type', currentFilter);
        } else {
            query = query.in('type', ['role_card', 'beautify']);
        }

        const { data, error } = await query;
        if (error) throw error;

        renderItems(data || []);
    } catch (e) {
        toast.error("获取失败: " + e.message);
        grid.html('<div style="text-align:center; padding:20px;">加载失败</div>');
    }
}

function renderItems(items) {
    const grid = $('#museum-grid');
    grid.empty();

    if (items.length === 0) {
        grid.html('<div style="text-align:center; padding:20px;">暂无内容</div>');
        return;
    }

    items.forEach(item => {
        let title = "未命名";
        let typeLabel = "未知";
        let imgUrl = "";
        
        if (item.type === 'role_card') {
            typeLabel = "角色";
            try {
                if (item.content.startsWith('{')) {
                    const json = JSON.parse(item.content);
                    title = json.name;
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
                if (json.variations && json.variations[0]) {
                    imgUrl = json.variations[0].preview;
                }
            } catch (e) { }
        }

        const cardHtml = `
            <div class="museum-item" data-id="${item.id}">
                <div style="width:100%; aspect-ratio:2/3; background:#222; overflow:hidden; display:flex; align-items:center; justify-content:center;">
                    <img src="${imgUrl}" style="width:100%; height:100%; object-fit:cover; transition: transform 0.3s;" loading="lazy">
                </div>
                <div class="museum-info">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="museum-type-tag">${typeLabel}</span>
                    </div>
                    <div class="museum-title" title="${title}">${title}</div>
                    <div class="museum-action-btn import-btn">
                        <i class="fa-solid fa-download"></i> 导入
                    </div>
                </div>
            </div>
        `;
        
        const $card = $(cardHtml);
        $card.find('.import-btn').on('click', () => handleImport(item));
        grid.append($card);
    });
}

async function handleImport(item) {
    if (item.type === 'role_card') await importRoleCard(item);
    else if (item.type === 'beautify') await importBeautify(item);
}

async function importRoleCard(item) {
    const btn = $(`div[data-id="${item.id}"] .import-btn`);
    const originalText = btn.html();
    btn.html('<i class="fa-solid fa-spinner fa-spin"></i>');

    try {
        const response = await fetch(item.file_url);
        const blob = await response.blob();
        const file = new File([blob], "card.png", { type: blob.type });
        const formData = new FormData();
        formData.append('avatar', file);

        const res = await fetch('/api/characters/import', { method: 'POST', body: formData });
        const result = await res.json();

        if (result.file_name) {
            toast.success(`角色 "${result.name}" 已导入`);
            $("#rm_button_characters").click(); 
        } else {
            throw new Error("API 返回异常");
        }
    } catch (e) {
        toast.error("导入失败: " + e.message);
    } finally {
        btn.html(originalText);
    }
}

async function importBeautify(item) {
    const btn = $(`div[data-id="${item.id}"] .import-btn`);
    const originalText = btn.html();
    btn.html('<i class="fa-solid fa-spinner fa-spin"></i>');

    try {
        let cssUrl = "";
        try {
            const json = JSON.parse(item.content);
            if (json.variations && json.variations[0]) cssUrl = json.variations[0].file;
        } catch(e) {}

        if (!cssUrl) throw new Error("未找到 CSS 链接");
        const res = await fetch(cssUrl);
        const cssText = await res.text();
        if (!cssText) throw new Error("CSS 内容为空");

        const textArea = document.getElementById('customCSS');
        if (textArea) {
            textArea.value = cssText;
            textArea.dispatchEvent(new Event('input', { bubbles: true }));
            
            // 触发 SillyTavern 保存逻辑
            const context = getContext();
            if (context && context.saveSettingsDebounced) context.saveSettingsDebounced();
            
            toast.success("主题应用成功");
        } else {
            toast.warning("找不到 CSS 输入框，请确保您在用户设置界面");
        }
    } catch (e) {
        toast.error("美化导入失败: " + e.message);
    } finally {
        btn.html(originalText);
    }
}

// --- 界面创建 (参考参考代码的写法) ---

function createSettingsHtml() {
    // 获取当前设置用于回填 HTML
    const settings = getExtensionSettings()[EXTENSION_NAME] || {};
    
    return `
    <div id="${EXTENSION_ID}" class="inline-drawer wide100p flexFlowColumn">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b><i class="fa-solid fa-building-columns"></i> 博物馆 (Museum)</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>

        <div class="inline-drawer-content museum-drawer-content">
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

            <div id="museum-grid" class="museum-grid">
                <div style="grid-column:1/-1; text-align:center; padding:20px; opacity:0.5; font-size:0.8em;">
                    点击上方刷新按钮加载内容
                </div>
            </div>
        </div>
    </div>
    `;
}

// --- 初始化逻辑 (模仿参考代码结构) ---

function initializePlugin() {
    console.log("[Museum] 初始化...");

    // 1. 确保设置对象存在 (数据迁移/初始化)
    const settings = getExtensionSettings();
    if (settings && !settings[EXTENSION_NAME]) {
        settings[EXTENSION_NAME] = { sbUrl: "", sbKey: "", sbEmail: "", sbPass: "" };
        saveExtensionSettings();
    }

    // 2. 注入 HTML UI
    const targetContainer = document.getElementById('extensions_settings'); // 优先左侧
    const secondaryContainer = document.getElementById('extensions_settings2'); // 备选右侧
    
    // 如果已经存在，不重复注入
    if (document.getElementById(EXTENSION_ID)) return;

    const html = createSettingsHtml();
    
    // 逻辑：如果有右侧容器且不为空，插到右侧；否则插到左侧
    if (secondaryContainer) {
        secondaryContainer.insertAdjacentHTML('beforeend', html);
    } else if (targetContainer) {
        targetContainer.insertAdjacentHTML('beforeend', html);
    } else {
        console.error("[Museum] 找不到扩展面板容器 (#extensions_settings)");
    }

    // 3. 绑定事件监听 (jQuery)
    // 切换配置面板
    $('#museum-config-toggle').on('click', () => $('#museum-auth-panel').slideToggle());
    
    // 保存设置
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

    // 过滤器切换
    $('.museum-filter-btn').on('click', function() {
        $('.museum-filter-btn').removeClass('active');
        $(this).addClass('active');
        currentFilter = $(this).data('filter');
        refreshGallery();
    });

    // 刷新按钮
    $('#museum-refresh-btn').on('click', refreshGallery);

    // 4. 预加载 Supabase SDK
    loadSupabase().then(() => {
        // 尝试自动登录并加载（如果已配置）
        const s = getExtensionSettings()[EXTENSION_NAME];
        if (s && s.sbUrl && s.sbKey) {
            initSupabaseClient().then(() => {
                if (session) refreshGallery();
            });
        }
    });

    console.log("[Museum] 初始化完成");
}

// --- 启动器 (IIFE) ---
(function () {
    // 递归等待 SillyTavern 上下文就绪
    const waitForSillyTavernContext = () => {
        const context = getContext();
        if (context && context.eventSource && context.eventTypes) {
            // 监听 APP_READY 事件
            // 此时 settings.json 已加载，DOM 已构建
            context.eventSource.once(context.eventTypes.APP_READY, () => {
                // 给一点小延迟确保 DOM 容器完全渲染
                setTimeout(initializePlugin, 500);
            });
        } else {
            // 还没准备好，稍后再试
            setTimeout(waitForSillyTavernContext, 100);
        }
    };

    waitForSillyTavernContext();
})();
