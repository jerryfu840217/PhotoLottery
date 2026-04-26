const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

// 設定要測試的目標網址
// 如果要測正式環境，請改成 https://photolottery.onrender.com/api/photos
const TARGET_URL = 'http://localhost:3000/api/photos';

// 照片數量
const NUM_PHOTOS = 500;
// 短時間內併發數 (在幾秒內發送)
const BURST_TIME_MS = 3000; 

// 建議先準備一張測試用的圖片 test.jpg 放在同一目錄下
// 這裡用一個簡單的方法，如果你沒有 test.jpg，可以自己放一張
async function runLoadTest() {
  const testImagePath = path.join(__dirname, 'test.jpg');
  
  if (!fs.existsSync(testImagePath)) {
    console.error('請先在專案根目錄準備一張測試圖片，命名為 test.jpg');
    return;
  }

  console.log(`即將在 ${BURST_TIME_MS / 1000} 秒內發送 ${NUM_PHOTOS} 個請求至 ${TARGET_URL}...`);

  const requests = [];
  const delayBetweenRequests = BURST_TIME_MS / NUM_PHOTOS;

  for (let i = 0; i < NUM_PHOTOS; i++) {
    // 建立延遲，模擬在 3 秒內慢慢湧入，而不是 0 毫秒全部發送
    const delay = i * delayBetweenRequests;
    
    // 準備 FormData
    const formData = new FormData();
    formData.append('photo', fs.createReadStream(testImagePath));
    formData.append('participantName', `LoadTester_${i}`);

    const reqPromise = new Promise((resolve) => {
      setTimeout(async () => {
        try {
          const startTime = Date.now();
          const response = await axios.post(TARGET_URL, formData, {
            headers: formData.getHeaders(),
          });
          const latency = Date.now() - startTime;
          resolve({ success: true, index: i, latency });
        } catch (error) {
          resolve({ success: false, index: i, error: error.message });
        }
      }, delay);
    });

    requests.push(reqPromise);
  }

  const results = await Promise.all(requests);
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log('\n--- 測試結果 ---');
  console.log(`總請求數: ${NUM_PHOTOS}`);
  console.log(`成功: ${successful.length}`);
  console.log(`失敗: ${failed.length}`);
  
  if (successful.length > 0) {
    const avgLatency = successful.reduce((sum, r) => sum + r.latency, 0) / successful.length;
    console.log(`平均成功回應時間: ${avgLatency.toFixed(2)} ms`);
  }

  if (failed.length > 0) {
    console.log('部分錯誤訊息範例:');
    console.log(failed.slice(0, 5).map(f => `[${f.index}] ${f.error}`).join('\n'));
  }
}

runLoadTest();
