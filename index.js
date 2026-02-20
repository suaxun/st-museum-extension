// 使用 SillyTavern 全局上下文，避免相对路径地狱
const EXTENSION_NAME = "museum_importer";

// 引用全局变量的简写
const getContext = () => window.SillyTavern && window.SillyTavern.getContext ? window.SillyTavern.getContext() : {};
// 如果 SillyTavern 没有暴露某些模块到全局，我们需要手动获取
// 通常 extension_settings 是挂载在全局的，或者通过 window.SillyTavern.extension_settings
// 但为了保险，我们这里尽量防御性编程

// 全局变量
let supabase = null;
let session = null;
let currentFilter = 'all'; 

// 1. 动态加载 Supabase SDK (通过 CDN)
async function loadSupabase() {
    if (window.supabase) return;
    console.log("[Museum] Loading Supabase SDK...");
    
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = "https://unpkg.com/@supabase/supabase-js@2";
        script.onload = () => {
            console.log("[Museum] Supabase SDK loaded.");
            resolve();
        };
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// 辅助函数：获取设置
function getSettings() {
    // 尝试从全局 extension_settings 获取
    // 注意：ST 内部模块通常是 ESM，全局访问可能受限。
    // 如果上面的 import 失败，我们需要一种变通方法。
    // 但 ST 的 extension_settings 实际上是一个导出的对象。
    // 让我们尝试混合方案：如果 import 失败，代码就跑不起来。
    // 所以这里的关键还是路径。
    
    // 如果你依然想用 import，请确保文件结构是：
    // SillyTavern/public/scripts/extensions/third-party/st-museum-extension/index.js
    // 此时 ../../../extensions.js 指向 SillyTavern/public/scripts/extensions.js -> 这里的确是正解。
}

// 2. 初始化 Supabase 客户端
async function initSupabaseClient(settings) {
    if (!settings.sbUrl || !settings.sbKey) return false;
    if (!window.supabase) await loadSupabase();
    
    try {
        supabase = window.supabase.createClient(settings.sbUrl, settings.sbKey);
        
        const { data } = await supabase.auth.getSession();
        if (data.session) {
            session = data.session;
            return true;
        } else if (settings.sbEmail && settings.sbPass) {
            return await doLogin(settings);
        }
        return false;
    } catch (e) {
        console.error("[Museum] Init Supabase failed:", e);
        return false;
    }
}

// 3. 登录逻辑
async function doLogin(settings) {
    if (!supabase) return false;
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: settings.sbEmail,
            password: settings.sbPass
        });
        if (error) throw error;
        session = data.session;
        toastr.success("博物馆登录成功");
        return true;
    } catch (e) {
        toastr.error("博物馆登录失败: " + e.message);
        return false;
    }
}

// 4. 获取数据
async function fetchMuseumItems() {
    if (!supabase || !session) {
        toastr.warning("请先登录博物馆");
        renderLogin();
        return;
    }

    const loader = $('#museum-loader');
    loader.show();
    
    try {
        let query = supabase
            .from("fragments")
            .select("*")
            .order("created_at", { ascending: false });
            
        if (currentFilter !== 'all') {
            query = query.eq('type', currentFilter);
        } else {
            query = query.in('type', ['role_card', 'beautify']);
        }

        const { data, error } = await query;
        if (error) throw error;
        renderGallery(data || []);
    } catch (e) {
        console.error(e);
        toastr.error("获取数据失败");
    } finally {
        loader.hide();
    }
}

// 5. 导入角色卡
async function importRoleCard(item) {
    toastr.info("正在下载并导入角色卡...");
    try {
        const imageUrl = item.file_url;
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        const file = new File([blob], "card.png", { type: blob.type });

        const formData = new FormData();
        formData.append('avatar', file);
        
        const importRes = await fetch('/api/characters/import', {
            method: 'POST',
            body: formData
        });

        const result = await importRes.json();
        
        if (result.file_name) {
            toastr.success(`角色 "${result.name || item.content}" 导入成功！`);
            $("#rm_button_characters").click(); 
        } else {
            throw new Error("API 返回错误");
        }
    } catch (e) {
        console.error(e);
        toastr.error("角色卡导入失败");
    }
}

// 6. 导入美化 (CSS)
async function importBeautify(item) {
    toastr.info("正在应用美化主题...");
    try {
        let variations = [];
        try {
            const jsonContent = JSON.parse(item.content);
            variations = jsonContent.variations || [];
        } catch (e) {
            toastr.error("美化数据解析错误");
            return;
        }

        const targetVariant = variations[0];
        if (!targetVariant || !targetVariant.file) {
            toastr.warning("未找到 CSS 文件链接");
            return;
        }

        const cssUrl = targetVariant.file;
        const res = await fetch(cssUrl);
        const cssText = await res.text();
        
        if (!cssText) throw new Error("CSS 内容为空");

        const cssTextArea = document.getElementById('customCSS');
        if (cssTextArea) {
            cssTextArea.value = cssText;
            cssTextArea.dispatchEvent(new Event('input', { bubbles: true }));
            toastr.success(`主题 "${jsonContent.title}" 应用成功！`);
        } else {
            toastr.error("找不到 CSS 编辑框，请确保处于用户设置界面");
        }
    } catch (e) {
        console.error(e);
        toastr.error("美化导入失败: " + e.message);
    }
}

// UI 渲染：登录界面
function renderLogin() {
    // 动态获取当前的 settings
    // 这里的 import 位于函数内部是不合法的，所以我们必须在顶部解决 import 问题
    // 此处仅做逻辑展示，具体看下方的 jQuery 入口
    
    // 为了避开 module 问题，我们在这里重新获取一次全局变量（如果改用 import 方案成功，这里不需要改）
    const container = $('#museum-gallery');
    container.empty();
    
    // 获取当前扩展设置的快照
    const currentSettings = extension_settings[EXTENSION_NAME] || { sbUrl: "", sbKey: "", sbEmail: "", sbPass: ""};

    const html = `
        <div class="museum-login-form">
            <h3>登录到博物馆</h3>
            <input type="text" id="museum-url" class="text_pole" placeholder="Supabase URL" value="${currentSettings.sbUrl || ''}">
            <input type="password" id="museum-key" class="text_pole" placeholder="Supabase Key" value="${currentSettings.sbKey || ''}">
            <input type="text" id="museum-email" class="text_pole" placeholder="Email" value="${currentSettings.sbEmail || ''}">
            <input type="password" id="museum-pass" class="text_pole" placeholder="Password" value="${currentSettings.sbPass || ''}">
            <button id="museum-login-btn" class="menu_button">登录</button>
        </div>
    `;
    
    container.html(html);
    
    $('#museum-login-btn').on('click', async () => {
        const newSettings = {
            sbUrl: $('#museum-url').val().trim(),
            sbKey: $('#museum-key').val().trim(),
            sbEmail: $('#museum-email').val().trim(),
            sbPass: $('#museum-pass').val().trim()
        };
        
        extension_settings[EXTENSION_NAME] = newSettings;
        saveSettingsDebounced();
        
        await initSupabaseClient(newSettings);
        if (session) {
            fetchMuseumItems();
        }
    });
}

function renderGallery(items) {
    const container = $('#museum-gallery');
    container.empty();
    
    if (items.length === 0) {
        container.html('<div style="width:100%;text-align:center;padding:20px;">暂无内容</div>');
        return;
    }

    items.forEach(item => {
        let title = "未命名";
        let desc = "";
        let previewImg = "";
        
        if (item.type === 'role_card') {
            try {
                if (item.content.startsWith('{')) {
                    const json = JSON.parse(item.content);
                    title = json.name;
                    desc = "角色卡";
                } else {
                    title = item.content;
                }
                previewImg = item.file_url;
            } catch(e) { title = item.content; }
        } else if (item.type === 'beautify') {
            try {
                const json = JSON.parse(item.content);
                title = json.title;
                desc = "美化主题";
                if (json.variations && json.variations[0]) {
                    previewImg = json.variations[0].preview;
                }
            } catch(e) {}
        }

        const card = $(`
            <div class="museum-card" data-id="${item.id}">
                <img src="${previewImg}" class="museum-card-img" loading="lazy">
                <div class="museum-card-info">
                    <div class="museum-card-type">${item.type === 'role_card' ? 'ROLE' : 'THEME'}</div>
                    <div class="museum-card-title" title="${title}">${title}</div>
                    <button class="museum-import-btn">导入 / 应用</button>
                </div>
            </div>
        `);

        card.find('.museum-import-btn').on('click', () => {
            if (item.type === 'role_card') importRoleCard(item);
            else if (item.type === 'beautify') importBeautify(item);
        });

        container.append(card);
    });
}

function createModal() {
    if ($('#museum-modal').length) return;

    const modalHtml = `
        <div id="museum-modal">
            <div class="museum-modal-content">
                <div class="museum-header">
                    <div class="museum-tabs">
                        <div class="museum-tab active" data-filter="all">全部</div>
                        <div class="museum-tab" data-filter="role_card">角色卡</div>
                        <div class="museum-tab" data-filter="beautify">美化</div>
                    </div>
                    <div class="museum-close-btn">&times;</div>
                </div>
                <div id="museum-gallery" class="museum-body">
                    <!-- 内容区 -->
                </div>
                <div id="museum-loader" style="display:none; text-align:center; padding:10px;">加载中...</div>
            </div>
        </div>
    `;
    
    $('body').append(modalHtml);

    $('.museum-close-btn').on('click', () => {
        $('#museum-modal').removeClass('active');
    });
    
    $('#museum-modal').on('click', (e) => {
        if (e.target.id === 'museum-modal') {
            $('#museum-modal').removeClass('active');
        }
    });

    $('.museum-tab').on('click', function() {
        $('.museum-tab').removeClass('active');
        $(this).addClass('active');
        currentFilter = $(this).data('filter');
        fetchMuseumItems();
    });
}

function openMuseum() {
    createModal();
    $('#museum-modal').addClass('active');
    
    const currentSettings = extension_settings[EXTENSION_NAME] || {};

    if (session) {
        fetchMuseumItems();
    } else {
        initSupabaseClient(currentSettings).then(success => {
            if (success) fetchMuseumItems();
            else renderLogin();
        });
    }
}

// 导入模块
// 关键点：使用 ../../../ 路径
import {
    extension_settings,
    saveSettingsDebounced
} from "../../../extensions.js";

// 入口函数
jQuery(async () => {
    // 确保 extension_settings 初始化
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = { sbUrl: "", sbKey: "", sbEmail: "", sbPass: "" };
    }

    const settingsHtml = `
        <div class="museum-settings-block">
            <h3>🏛️ 博物馆 (Museum)</h3>
            <p style="font-size:0.8em; opacity:0.7;">连接到您的私人 Supabase 素材库。</p>
            <div class="flex-container">
                <button id="museum-open-btn" class="menu_button">
                    <i class="fa-solid fa-building-columns"></i> 打开博物馆
                </button>
            </div>
        </div>
    `;

    setTimeout(() => {
        const target = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
        target.append(settingsHtml);
        $('#museum-open-btn').on('click', openMuseum);
        loadSupabase();
    }, 500);
});
