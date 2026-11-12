const puppeteer = require('puppeteer-core');
const fs = require('fs');

const TARGET_URL = process.env.CAMPAIGN_URL || 'https://auctionr.org/4/5a41eae4c9364b8088fd4ff777a02672';
const VISITOR_COUNT = parseInt(process.env.VISITOR_COUNT || '10', 10);

const MAX_DATA_MB = parseFloat(process.env.MAX_MB || '1.0');
const MAX_DATA_BYTES = MAX_DATA_MB * 1024 * 1024; 

const sessionMinutes = parseFloat(process.env.SESSION_MINUTES || '0.5');

// GitHub এবং Termux উভয় পরিবেশের জন্য ব্রাউজার পাথ চেক
const executablePath = fs.existsSync('/usr/bin/google-chrome') 
    ? '/usr/bin/google-chrome' 
    : '/data/data/com.termux/files/usr/bin/chromium';

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function runVisitor(visitorNum) {
    console.log(`[Visitor ${visitorNum}] Starting direct session -> Max Limit: ${MAX_DATA_MB} MB`);

    const browser = await puppeteer.launch({
        executablePath: executablePath,
        headless: 'new',
        args: [
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=375,812',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process,TranslateUI,NetworkService',
            '--disable-extensions',
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps',
            '--mute-audio',
            '--no-default-browser-check',
            '--no-pings',
            '--disable-infobars',
            '--lang=en-US,en'
        ]
    });

    let totalBytesTransferred = 0;
    const sessionStartTime = Date.now();

    try {
        const page = await browser.newPage();

        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            window.chrome = { runtime: {} };
            
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(parameter) {
                if (parameter === 37445) return 'Apple Inc.';
                if (parameter === 37446) return 'Apple GPU';
                return getParameter(function() { return this; }.call(this), parameter);
            };
        });

        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1');
        await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });

        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Sec-Ch-Ua': '"Chromium";v="116", "Not)A;Brand";v="24", "Google Chrome";v="116"',
            'Sec-Ch-Ua-Mobile': '?1',
            'Sec-Ch-Ua-Platform': '"iOS"'
        });

        // --- ডাটা সেভিং ইন্টারসেপশন ---
        await page.setRequestInterception(true);
        page.on('request', req => {
            if (totalBytesTransferred >= MAX_DATA_BYTES) {
                req.abort();
                return;
            }

            const resourceType = req.resourceType();
            const url = req.url();

            if (
                ['image', 'font', 'media', 'manifest', 'websocket'].includes(resourceType) ||
                url.includes('google-analytics.com') ||
                url.includes('googletagmanager.com') ||
                url.includes('facebook.net') ||
                url.includes('hotjar.com') ||
                url.endsWith('.map')
            ) {
                req.abort();
            } else {
                req.continue();
            }
        });

        page.on('response', async res => {
            try {
                const buffer = await res.buffer().catch(() => null);
                if (buffer) {
                    totalBytesTransferred += buffer.length;
                    if (totalBytesTransferred >= MAX_DATA_BYTES) {
                        try { await page.close(); } catch (e) {}
                    }
                }
            } catch (e) {}
        });

        console.log(`[Visitor ${visitorNum}] Visiting URL: ${TARGET_URL}`);
        await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
        console.log(`[Visitor ${visitorNum}] Page fully loaded and verified!`);

        // পপআপ বাইপাস হ্যান্ডলার
        try {
            console.log(`[Visitor ${visitorNum}] Scanning page for security/age verification popups...`);
            
            for (let step = 1; step <= 3; step++) {
                if (totalBytesTransferred >= MAX_DATA_BYTES) break;
                await new Promise(resolve => setTimeout(resolve, 2000)); 
                
                const clickedInfo = await page.evaluate(() => {
                    const elements = Array.from(document.querySelectorAll('button, a, div, span, input[type="button"], input[type="submit"]'));
                    const targetKeywords = [
                        'yes', 'continue', 'i am 18', 'i am over 18', '18+', 'enter', 
                        'agree', 'accept', 'verify', 'proceed', 'ok', 'موافق', 'حاب', 'human', 'access', 'i agree'
                    ];

                    for (let el of elements) {
                        const text = el.innerText ? el.innerText.trim().toLowerCase() : '';
                        const value = el.value ? el.value.trim().toLowerCase() : '';
                        const ariaLabel = el.getAttribute('aria-label') ? el.getAttribute('aria-label').toLowerCase() : '';
                        
                        const matched = targetKeywords.some(keyword => text.includes(keyword) || value.includes(keyword) || ariaLabel.includes(keyword));
                        
                        if (matched && el.offsetParent !== null) {
                            el.click();
                            return { success: true, text: text || value || ariaLabel };
                        }
                    }
                    return { success: false };
                });

                if (clickedInfo && clickedInfo.success) {
                    console.log(`[Visitor ${visitorNum}] [SUCCESS] Step ${step}: Popup bypassed! Clicked: "${clickedInfo.text}"`);
                }
            }
        } catch (e) {}

        // সেন্ট্রাল ক্লিক এবং রিডাইরেক্ট পেজ হ্যান্ডলিং
        try {
            await new Promise(resolve => setTimeout(resolve, 3000));
            let actionDone = false;

            const playClicked = await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('button, a, div, span, video, input[type="button"]'));
                const playKeywords = ['play', 'start', 'watch', 'stream', 'click', 'load', 'join', 'view', 'موافق', 'تشغيل'];

                for (let el of elements) {
                    const text = el.innerText ? el.innerText.trim().toLowerCase() : '';
                    const className = el.className ? String(el.className).toLowerCase() : '';
                    const idName = el.id ? String(el.id).toLowerCase() : '';
                    
                    const isPlayElement = playKeywords.some(kw => text.includes(kw) || className.includes(kw) || idName.includes(kw));
                    
                    if (isPlayElement && el.offsetParent !== null) {
                        el.click();
                        return { success: true, descriptor: text || className || idName };
                    }
                }
                return { success: false };
            });

            if (playClicked && playClicked.success) {
                console.log(`[Visitor ${visitorNum}] [SUCCESS] Clicked on Play/Action button: "${playClicked.descriptor}"`);
                actionDone = true;
            }

            if (!actionDone) {
                console.log(`[Visitor ${visitorNum}] No explicit action button found. Waiting to click center of screen...`);
                await new Promise(resolve => setTimeout(resolve, 5000)); 

                await page.mouse.click(187, 406, { button: 'left' });
                console.log(`[Visitor ${visitorNum}] Clicked at the center of the mobile screen.`);

                console.log(`[Visitor ${visitorNum}] Waiting on redirected page...`);
                await new Promise(resolve => setTimeout(resolve, 2000));

                const pages = await browser.pages();
                if (pages.length > 2) {
                    const newPage = pages[pages.length - 1];
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    await newPage.close().catch(() => {});
                    console.log(`[Visitor ${visitorNum}] Closed redirected tab and returned to main page.`);
                } else {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
                    console.log(`[Visitor ${visitorNum}] Performed goBack() and returned to main page.`);
                }
            }
        } catch (e) {}

        // --- ঠিক ৫ সেকেন্ড পর স্ক্রিনশট তোলার ব্যবস্থা ---
        console.log(`[Visitor ${visitorNum}] Waiting 5 seconds to take main page screenshot...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        await page.screenshot({ path: `screenshot_visitor_${visitorNum}.png` }).catch(() => {});
        console.log(`[Visitor ${visitorNum}] Main page screenshot taken successfully!`);

        const targetDurationSec = Math.max(10, Math.floor(sessionMinutes * 60)); 
        const targetDurationMs = targetDurationSec * 1000;
        const sessionStartTimeOffset = Date.now(); 

        console.log(`[Visitor ${visitorNum}] Session active target: ~${targetDurationSec} Seconds...`);

        while (Date.now() - sessionStartTimeOffset < targetDurationMs) {
            if (totalBytesTransferred >= MAX_DATA_BYTES) {
                console.log(`[Visitor ${visitorNum}] Data limit reached! Exiting...`);
                break;
            }

            try {
                const scrollAmount = getRandomInt(100, 300);
                await page.evaluate((scrollVal) => {
                    window.scrollBy({ top: scrollVal, behavior: 'smooth' });
                }, scrollAmount);
            } catch (err) {}

            const pauseTime = getRandomInt(3000, 5000);
            await new Promise(resolve => setTimeout(resolve, pauseTime));
        }

        const totalDurationSec = ((Date.now() - sessionStartTime) / 1000).toFixed(1);
        const finalMB = (totalBytesTransferred / (1024 * 1024)).toFixed(4);
        const finalKB = (totalBytesTransferred / 1024).toFixed(2);

        console.log(`[Visitor ${visitorNum}] [SUCCESS] Session completed & Exited!`);
        console.log(`[Visitor ${visitorNum}] -> Total Time on Page: ${totalDurationSec} seconds`);
        console.log(`[Visitor ${visitorNum}] -> Total Data Used: ${finalMB} MB (${finalKB} KB)`);

    } catch (error) {
        const totalDurationSec = ((Date.now() - sessionStartTime) / 1000).toFixed(1);
        const finalMB = (totalBytesTransferred / (1024 * 1024)).toFixed(4);
        console.log(`[Visitor ${visitorNum}] [INFO] Session ended (${error.message}). Time: ${totalDurationSec}s | Data Used: ${finalMB} MB`);
    } finally {
        await browser.close();
    }
}

async function main() {
    console.log(`Starting direct visitor bot execution for ${VISITOR_COUNT} visitors...`);
    
    for (let i = 1; i <= VISITOR_COUNT; i++) {
        console.log(`Launching Visitor ${i}...`);
        runVisitor(i).catch(err => console.log(`Visitor ${i} failed: ${err.message}`));
        await new Promise(resolve => setTimeout(resolve, 4000));
    }
}

main();
