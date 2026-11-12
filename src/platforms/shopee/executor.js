/**
 * Shopee 采集执行器
 * 
 * 从 Shopee 采集卖家/商品信息（东南亚电商平台）
 */

const axios = require('axios');
const { injectProxy } = require('../../outbound-proxy');

class ShopeeExecutor {
  constructor(db) {
    this.db = db;
  }

  /** 构建带代理的axios config */
  _axiosConfig(accountId, extra = {}) {
    return injectProxy(this.db, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        ...extra.headers
      },
      ...extra
    }, accountId);
  }

  async execute(context) {
    switch (context.action) {
      case 'collect_sellers':
        return await this._collectSellers(context);
      case 'collect_products':
        return await this._collectProducts(context);
      case 'collect_reviews':
        return await this._collectReviews(context);
      default:
        throw new Error('shopee: 不支持的动作 ' + context.action);
    }
  }

  async _collectSellers(context) {
    const { inputData, accountIds, onProgress, onItem, onCollected, intervalMin = 3, intervalMax = 8 } = context;
    const { keyword, shopRegion = 'sg', maxResults = 100 } = inputData;
    const accountId = (accountIds && accountIds[0]) || null;
    
    console.log(`🛒 Shopee 卖家采集: "${keyword}" @ ${shopRegion}`);

    const regionDomains = {
      sg: 'shopee.sg', my: 'shopee.com.my', th: 'shopee.co.th',
      ph: 'shopee.ph', vn: 'shopee.vn', id: 'shopee.co.id',
      tw: 'shopee.tw', br: 'shopee.com.br'
    };
    const domain = regionDomains[shopRegion] || 'shopee.sg';

    let processed = 0, success = 0, failed = 0;

    try {
      const searchUrl = `https://${domain}/api/v4/search/search_items?keyword=${encodeURIComponent(keyword)}&limit=${Math.min(maxResults, 60)}&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2`;
      
      const response = await axios.get(searchUrl, this._axiosConfig(accountId, {
        headers: { 'Referer': `https://${domain}/` }
      }));

      const items = response.data?.items || [];
      const sellerMap = new Map();

      for (const item of items) {
        const shopId = item.item_basic?.shopid;
        if (!shopId || sellerMap.has(shopId)) continue;
        sellerMap.set(shopId, true);

        processed++;
        
        // 获取店铺详情
        try {
          const shopInfo = await this._getShopInfo(domain, shopId, accountId);
          success++;
          
          onCollected({
            data_type: 'seller',
            external_id: `shopee_${shopRegion}_${shopId}`,
            display_name: shopInfo.name || `Shop ${shopId}`,
            profile_url: `https://${domain}/shop/${shopId}`,
            username: shopInfo.account?.username || '',
            followers_count: shopInfo.follower_count || 0,
            country: shopRegion.toUpperCase(),
            raw: {
              shop_id: shopId,
              rating: shopInfo.rating_star,
              products: shopInfo.item_count,
              response_rate: shopInfo.response_rate,
              response_time: shopInfo.response_time,
              joined: shopInfo.ctime,
              ...shopInfo
            }
          });

          onItem({ target: shopInfo.name || shopId, success: true, result: shopInfo });
        } catch (e) {
          failed++;
          onItem({ target: String(shopId), success: false, result: { error: e.message } });
        }

        onProgress(processed, success, failed);

        if (processed >= maxResults) break;
        await new Promise(r => setTimeout(r, (intervalMin + Math.random() * (intervalMax - intervalMin)) * 1000));
      }
    } catch (error) {
      console.error('Shopee 采集失败:', error.message);
    }

    console.log(`✅ Shopee 卖家采集完成: ${success}/${processed}`);
    return { total: processed, success, failed };
  }

  async _collectProducts(context) {
    const { inputData, accountIds, onProgress, onItem, onCollected, intervalMin = 2, intervalMax = 5 } = context;
    const { keyword, shopRegion = 'sg', maxResults = 100, minPrice, maxPrice } = inputData;
    const accountId = (accountIds && accountIds[0]) || null;

    const regionDomains = { sg: 'shopee.sg', my: 'shopee.com.my', th: 'shopee.co.th', ph: 'shopee.ph', vn: 'shopee.vn', id: 'shopee.co.id' };
    const domain = regionDomains[shopRegion] || 'shopee.sg';

    let processed = 0, success = 0, failed = 0;

    try {
      const searchUrl = `https://${domain}/api/v4/search/search_items?keyword=${encodeURIComponent(keyword)}&limit=${Math.min(maxResults, 60)}&order=desc&page_type=search&version=2`;

      const response = await axios.get(searchUrl, this._axiosConfig(accountId, {
        headers: { 'Referer': `https://${domain}/` }
      }));

      for (const item of (response.data?.items || [])) {
        const basic = item.item_basic;
        if (!basic) continue;
        
        const price = (basic.price || 0) / 100000;
        if (minPrice && price < minPrice) continue;
        if (maxPrice && price > maxPrice) continue;

        processed++;
        success++;

        onCollected({
          data_type: 'product',
          external_id: `shopee_${shopRegion}_${basic.itemid}`,
          display_name: basic.name,
          profile_url: `https://${domain}/product/${basic.shopid}/${basic.itemid}`,
          raw: {
            item_id: basic.itemid,
            shop_id: basic.shopid,
            price, currency: basic.currency,
            sold: basic.historical_sold || basic.sold,
            rating: basic.item_rating?.rating_star,
            stock: basic.stock,
            images: (basic.images || []).map(img => `https://cf.shopee.sg/file/${img}`)
          }
        });

        onItem({ target: basic.name?.substring(0, 50), success: true, result: { price, sold: basic.sold } });
        onProgress(processed, success, failed);

        if (processed >= maxResults) break;
      }
    } catch (error) {
      console.error('Shopee 商品采集失败:', error.message);
    }

    return { total: processed, success, failed };
  }

  async _collectReviews(context) {
    const { inputData, onProgress, onItem, onCollected } = context;
    console.log('Shopee 评论采集:', inputData);
    return { total: 0, success: 0, failed: 0, message: 'Ready for implementation' };
  }

  async _getShopInfo(domain, shopId, accountId) {
    try {
      const res = await axios.get(`https://${domain}/api/v4/product/get_shop_info?shopid=${shopId}`,
        this._axiosConfig(accountId, { headers: { 'Referer': `https://${domain}/` } })
      );
      return res.data?.data || {};
    } catch (e) {
      return { shop_id: shopId };
    }
  }
}

module.exports = ShopeeExecutor;
