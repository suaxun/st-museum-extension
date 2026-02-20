// 扩展名称
const EXTENSION_NAME = "museum_importer";

// 全局变量引用
let supabase = null;
let session = null;
let currentFilter = 'all'; 

// 从全局获取 SillyTavern 的核心功能
const getContext = () => window.SillyTavern.getContext();
const { extension_settings, saveSettingsDebounced } = window.SillyTavern.libs ? window.SillyTavern : window;

// 辅助函数：获取 Toaster (通知提示)
const toast = {
    success: (msg) => window.toastr ? window.toastr.success(msg) : console.log(msg),
    error: (msg) => window.toastr ? window.toastr.error(msg) : console.error(msg),
    info: (msg) => window.toastr ? window.toastr.info(msg) : console.log(msg),
    warning: (msg) => window.toastr ? window.toastr.warning(msg) : console.warn(msg)
};

// 1. 动态加载 Supabase SDK
async function loadSupabase() {
    if (window.supabase) return;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = "https://unpkg.com/@supabase/supabase-js@2";
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// 2. 初始化 Supabase
async function initSupabaseClient() {
    const settings = extension_settings[EXTENSION_NAME];
    if (!settings.sbUrl || !settings.sbKey) return false;
    
    if (!window.supabase) await loadSupabase();

    try {
        supabase = window.supabase.createClient(settings.sbUrl, settings.sbKey);
        const { data } = await supabase.auth.getSession();
        if (data.session) {
            session = data.session;
            return true;
        } else if (settings.sbEmail && settings.sbPass) {
            return await doLogin();
        }
        return false;
    } catch (e) {
        console.error("[Museum] Init failed:", e);
        return false;
    }
}

// 3. 登录
async function doLogin() {
    if (!supabase) return false;
    const settings = extension_settings[EXTENSION_NAME];
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

// 4. 获取数据并渲染
async function refreshGallery() {
    const grid = $('#museum-grid');
    grid.empty();
    grid.append('<div class="museum-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading...</div>');

    if (!supabase) await initSupabaseClient();
    if (!session) {
        grid.html('<div style="text-align:center; padding:20px; font-size:0.8em; opacity:0.7;">请点击上方齿轮图标<br>配置 Supabase 并登录</div>');
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
        toast.error("获取数据失败: " + e.message);
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
        
        // 解析数据逻辑
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

        // HTML 模板
        const cardHtml = `
            <div class="museum-item" data-id="${item.id}">
                <div style="width:100%; aspect-ratio:2/3; background:#000; overflow:hidden;">
                    <img src="${imgUrl}" style="width:100%; height:100%; object-fit:cover;" loading="lazy">
                </div>
                <div class="museum-info">
                    <div class="museum-type-tag">${typeLabel}</div>
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

// 5. 导入逻辑
async function handleImport(item) {
    if (item.type === 'role_card') {
        await importRoleCard(item);
    } else if (item.type === 'beautify') {
        await importBeautify(item);
    }
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

        // 调用 SillyTavern 的后端 API
        const res = await fetch('/api/characters/import', { method: 'POST', body: formData });
        const result = await res.json();

        if (result.file_name) {
            toast.success(`角色 "${result.name}" 导入成功！`);
            // 触发 ST 刷新角色列表
            $("#rm_button_characters").click();
        } else {
            throw new Error("API 返回错误");
        }
    } catch (e) {
        toast.error("角色导入失败: " + e.message);
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
            if (json.variations && json.variations[0]) {
                cssUrl = json.variations[0].file;
            }
        } catch(e) {}

        if (!cssUrl) throw new Error("未找到 CSS 文件链接");

        const res = await fetch(cssUrl);
        const cssText = await res.text();

        if (!cssText) throw new Error("CSS 内容为空");

        // 写入 ST 的 Custom CSS 编辑框
        const textArea = document.getElementById('customCSS');
        if (textArea) {
            textArea.value = cssText;
            textArea.dispatchEvent(new Event('input', { bubbles: true }));
            // 触发保存
            const { saveSettings } = window.SillyTavern.libs ? window.SillyTavern : window;
            if (saveSettings) saveSettings();
            toast.success(`主题应用成功！`);
        } else {
            toast.warning("找不到 CSS 输入框，请确保位于用户设置界面");
        }
    } catch (e) {
        toast.error("美化导入失败: " + e.message);
    } finally {
        btn.html(originalText);
    }
}

// 6. UI 构建函数
function buildExtensionUI() {
    // 避免重复创建
    if ($('#museum-extension-root').length) return;

    // 获取当前设置用于回填
    const settings = extension_settings[EXTENSION_NAME];

    const html = `
    <div id="museum-extension-root" class="inline-drawer wide100p flexFlowColumn">
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
                <input type="text" id="museum-sb-url" class="text_pole" placeholder="URL" value="${settings.sbUrl || ''}">
                <input type="password" id="museum-sb-key" class="text_pole" placeholder="Key" value="${settings.sbKey || ''}">
                <input type="text" id="museum-email" class="text_pole" placeholder="Email" value="${settings.sbEmail || ''}">
                <input type="password" id="museum-pass" class="text_pole" placeholder="Password" value="${settings.sbPass || ''}">
                <button id="museum-save-btn" class="menu_button">保存并登录</button>
            </div>

            <div class="museum-filter-bar">
                <div class="museum-filter-btn active" data-filter="all">全部</div>
                <div class="museum-filter-btn" data-filter="role_card">角色</div>
                <div class="museum-filter-btn" data-filter="beautify">美化</div>
            </div>

            <div id="museum-grid" class="museum-grid">
                <div style="grid-column:1/-1; text-align:center; padding:20px; opacity:0.5">
                    点击上方刷新按钮
                </div>
            </div>
        </div>
    </div>
    `;

    $('#extensions_settings2').append(html);

    // 事件绑定
    $('#museum-config-toggle').on('click', () => $('#museum-auth-panel').slideToggle());
    
    $('#museum-save-btn').on('click', async () => {
        settings.sbUrl = $('#museum-sb-url').val().trim();
        settings.sbKey = $('#museum-sb-key').val().trim();
        settings.sbEmail = $('#museum-email').val().trim();
        settings.sbPass = $('#museum-pass').val().trim();
        
        saveSettingsDebounced();
        
        const success = await initSupabaseClient();
        if (success) {
            $('#museum-auth-panel').slideUp();
            refreshGallery();
        }
    });

    $('.museum-filter-btn').on('click', function() {
        $('.museum-filter-btn').removeClass('active');
        $(this).addClass('active');
        currentFilter = $(this).data('filter');
        refreshGallery();
    });

    $('#museum-refresh-btn').on('click', refreshGallery);

    // 自动加载尝试
    if (settings.sbUrl && settings.sbKey) {
        initSupabaseClient().then(() => {
            if (session) refreshGallery();
        });
    }
}

// 7. 扩展加载入口
jQuery(async () => {
    // 初始化默认设置结构
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = {
            sbUrl: "", sbKey: "", sbEmail: "", sbPass: ""
        };
    }

    // 预加载库
    loadSupabase();

    // 等待 DOM 完全就绪
    setTimeout(buildExtensionUI, 1000);
});
