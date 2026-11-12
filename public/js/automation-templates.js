// 10 Pre-built automation sequence templates for VIPB B2B
const TEMPLATES = [
{id:'new_inquiry_nurture',icon:'🆕',name:'新询盘7天培育序列',steps:4,duration:'7天',cat:'lead_nurture',
desc:'新询盘进来后自动发送培育邮件，逐步建立信任并促成报价',
seq:[
{day:0,ch:'email',subj:'Thank You for Your Inquiry - {product_name} Catalog & Specs',
body:`Dear {contact_name},

Thank you for your interest in our {product_name}. We are VIPB, a leading manufacturer of Smart Energy Meters and Circuit Breakers with over 15 years of experience.

Please find attached our complete product catalog featuring:
• Single Phase & Three Phase Smart Energy Meters (IEC 62053-21/22/23 certified)
• MCB/MCCB/RCCB Circuit Breakers (IEC 60898, CE, KEMA approved)
• Prepaid Metering Solutions & AMI Systems

We serve utility companies, electrical distributors, and government projects across 60+ countries.

MOQ: 500 pcs | Lead Time: 25-35 days | Terms: FOB/CIF available

Looking forward to understanding your specific requirements for {country}.

Best regards,
VIPB Sales Team`},
{day:2,ch:'email',subj:'Technical Specifications - {product_name} for {country} Market',
body:`Dear {contact_name},

Following up on our previous email, here are detailed technical specifications for our {product_name} range.

Key Technical Highlights:
• Accuracy Class: 0.5S / 1.0 / 2.0 (per IEC 62053)
• Communication: RS485, DLMS/COSEM, LoRa, NB-IoT, GPRS
• Protection Rating: IP54 (meters) / IP20 (breakers)
• Operating Temperature: -25°C to +55°C
• Breaking Capacity: 6kA / 10kA / 15kA (MCB range)

All products come with complete test reports and compliance certificates. We can customize specifications to meet {country}'s local standards.

Best regards,
VIPB Technical Team`},
{day:5,ch:'email',subj:'Factory Tour Video & Quality Certifications - VIPB',
body:`Dear {contact_name},

I wanted to share our factory capabilities:

🏭 Our 20,000 sqm production facility:
• 4 SMT production lines
• Automated calibration systems
• 100% end-of-line testing
• Annual capacity: 2M meters & 5M breakers

📋 Quality Certifications:
• IEC 62052-11 / IEC 62053-21/22/23
• CE Marking (EU) / KEMA Type Test
• ISO 9001:2015 / ISO 14001:2015
• ANSI C12.20 (for Americas)

Would you like to schedule a live factory tour via video call?

Best regards,
VIPB Quality Assurance Team`},
{day:7,ch:'email',subj:'⏰ Special Offer for {company_name} - Valid 7 Days',
body:`Dear {contact_name},

As a special offer for new partners:

🎁 New Customer Benefits:
• 5% discount on first order (MOQ 1,000 pcs)
• Free samples (2-3 units for testing)
• Free technical support & training
• Dedicated account manager for {country}

📦 Quick Quote:
• Single Phase Smart Meter: from $12.50/pc FOB
• Three Phase Smart Meter: from $35.00/pc FOB
• MCB 1-63A: from $0.85/pc FOB
• MCCB 100-800A: from $8.50/pc FOB

⏰ This offer is valid for 7 days.

Best regards,
VIPB Sales Director`}
]},

{id:'cold_outreach',icon:'📧',name:'冷客户外拓序列',steps:4,duration:'14天',cat:'outreach',
desc:'主动联系潜在客户，从开场到最终跟进的完整外拓序列',
seq:[
{day:0,ch:'email',subj:'Smart Metering Solutions for {company_name}',
body:`Dear {contact_name},

I came across {company_name} and noticed your involvement in electrical distribution / utility projects in {country}.

VIPB is a manufacturer specializing in:
✅ Smart Energy Meters (Single/Three Phase, Prepaid, AMI)
✅ Circuit Breakers (MCB, MCCB, RCCB, RCBO)

We supply to 60+ countries with IEC, CE, and KEMA certifications.

Would you be open to a brief conversation about how we could support your needs?

Best regards,
VIPB Business Development`},
{day:3,ch:'email',subj:'Why Utilities in {country} Choose VIPB Meters',
body:`Dear {contact_name},

Quick follow-up. Here's why leading utilities choose VIPB:

📊 Product Advantages:
• DLMS/COSEM compliant - easy HES/MDM integration
• Multi-tariff support (up to 8 tariffs, 12 seasons)
• Anti-tamper features (magnetic, terminal cover, reverse current)
• 10+ year battery life for communication modules

💰 Commercial Advantages:
• Direct factory pricing - no middleman
• Flexible MOQ starting from 500 pcs
• OEM/ODM capabilities (your brand, your specs)
• 30% T/T deposit, 70% before shipment

Would you like a sample for evaluation?

Best regards,
VIPB Sales Team`},
{day:7,ch:'email',subj:'Case Study: 100K Smart Meter Rollout in Africa',
body:`Dear {contact_name},

A recent success story:

📋 Case Study: 100,000-Unit Smart Meter Rollout
• Client: National utility company in East Africa
• Products: Three Phase CT Meters + Single Phase Prepaid
• Timeline: 3 batches over 6 months
• Result: 98.5% first-pass installation rate, <0.3% failure

The client praised our pre-shipment inspection (100% tested), on-site training, and 24/7 technical support.

We've completed similar projects across Middle East, Southeast Asia, and South America.

Would a similar approach work for {country}?

Best regards,
VIPB Project Team`},
{day:14,ch:'email',subj:'Last Check-in - {contact_name}',
body:`Dear {contact_name},

I understand you may be busy. This will be my last email for now.

If you ever need:
• Competitive pricing on energy meters or circuit breakers
• A reliable manufacturer with IEC/CE/KEMA certifications
• Technical support for metering system integration

Please don't hesitate to reach out.

Wishing {company_name} continued success.

Best regards,
VIPB Sales Team`}
]},

{id:'quote_followup',icon:'🔄',name:'报价跟进序列',steps:4,duration:'14天',cat:'sales',
desc:'发送报价后的自动跟进，确认收到、解答疑问、优惠提醒',
seq:[
{day:1,ch:'email',subj:'Quotation Confirmation - {product_name} for {company_name}',
body:`Dear {contact_name},

Just confirming you received our quotation for {product_name}.

Quick summary:
• Products: {product_name}
• Certification: IEC 62053 / CE / KEMA
• Terms: FOB Ningbo / CIF {country} available
• Payment: 30% T/T deposit, 70% before shipment
• Validity: 30 days

Please don't hesitate to reach out with any questions.

Best regards,
VIPB Sales Team`},
{day:3,ch:'email',subj:'FAQ About Our Quotation - VIPB',
body:`Dear {contact_name},

Common questions our clients ask:

Q: Can you provide OEM branding?
A: Yes - custom logo, packaging, and user manual.

Q: What about warranty?
A: 5-year for meters, 3-year for breakers.

Q: Can you handle local certification?
A: Yes, experience with 40+ countries.

Q: What's included in the price?
A: Product, standard packaging, test report, certificate of conformity.

Any specific questions about technical specs or commercial terms?

Best regards,
VIPB Sales Team`},
{day:7,ch:'email',subj:'🎁 Volume Discount Available - {product_name}',
body:`Dear {contact_name},

Volume discount tiers for {company_name}:

📊 Volume Pricing:
• 1,000-4,999 pcs: 3% discount
• 5,000-9,999 pcs: 5% discount
• 10,000-49,999 pcs: 8% discount
• 50,000+ pcs: Special project pricing

Additionally for orders this month:
✅ Free DHL sample shipment
✅ Priority production scheduling
✅ Extended payment terms negotiable

Best regards,
VIPB Sales Team`},
{day:14,ch:'email',subj:'⏰ Quotation Expiring Soon - {company_name}',
body:`Dear {contact_name},

Friendly reminder: your quotation for {product_name} will expire soon.

Due to raw material price fluctuations (copper, PCB), pricing may adjust after validity period.

If you need:
• An extension of quotation validity
• Revised quantities or specifications
• CIF pricing for {country}

Please let me know and I'll prepare an updated proposal.

Best regards,
VIPB Sales Team`}
]},

{id:'vip_maintenance',icon:'💎',name:'VIP客户维护',steps:3,duration:'6个月',cat:'retention',
desc:'定期向VIP客户发送行业资讯、新品预览和专属折扣',
seq:[
{day:30,ch:'email',subj:'Monthly Industry Update - Smart Metering Trends',
body:`Dear {contact_name},

Your monthly industry update from VIPB:

📰 Industry Highlights:
• Global smart meter market growing 8.2% CAGR
• New IEC standards update for 2025
• Prepaid metering adoption accelerating in {country} region

🆕 VIPB Updates:
• New LoRaWAN meter module launched
• Expanded MCCB range up to 1600A
• New warehouse in Dubai for faster ME delivery

As our valued partner, you get early access to all new products.

Best regards,
VIPB Partnership Team`},
{day:90,ch:'email',subj:'Exclusive Preview: New Product Line for {company_name}',
body:`Dear {contact_name},

As a VIP partner, exclusive early access to our 2025 product line:

🆕 New Products:
• Gen-3 Smart Meter with integrated disconnect switch
• IoT-ready MCCB with Modbus/WiFi monitoring
• Solar bi-directional net metering solution
• Smart prepaid meter with STS token + mobile app

VIP partners can place pre-orders at 10% early-bird discount.

Shall we arrange a product presentation?

Best regards,
VIPB Product Director`},
{day:180,ch:'email',subj:'🎁 VIP Exclusive: Special Discount for {company_name}',
body:`Dear {contact_name},

To thank {company_name} for your continued partnership:

🎁 VIP Exclusive Offer:
• 10% discount on all orders this quarter
• Free freight on orders above $50,000
• Priority production (15-20 day lead time)
• Extended 60-day payment terms

This is our way of saying thank you for your loyalty.

Best regards,
VIPB CEO Office`}
]},

{id:'tender_followup',icon:'🏗️',name:'项目投标跟进',steps:3,duration:'10天',cat:'tender',
desc:'提交投标后的专业跟进序列',
seq:[
{day:1,ch:'email',subj:'Technical Support for Your Tender - {product_name}',
body:`Dear {contact_name},

Following our bid submission, our technical team is available for:

🔧 Support Available:
• Detailed technical clarifications
• Product compliance documentation
• Reference project site visits
• Live product demonstrations

Additional supporting documents ready:
• IEC type test reports & KEMA certificates
• Factory audit reports
• Previous project completion certificates

Best regards,
VIPB Tender Team`},
{day:5,ch:'email',subj:'Additional Documentation - {product_name} Tender',
body:`Dear {contact_name},

Additional supporting materials:

📄 Enclosed Documents:
• Detailed compliance matrix vs tender specs
• Third-party lab test reports
• Project references with contact details
• Proposed delivery & installation timeline
• After-sales service plan for {country}

We're fully committed to supporting this project.

Best regards,
VIPB Tender Team`},
{day:10,ch:'email',subj:'Tender Progress Check - {company_name}',
body:`Dear {contact_name},

Checking on the tender evaluation progress.

We remain fully committed and can provide:
• Additional samples for testing
• Factory visit arrangement
• Revised pricing if needed
• Extended warranty options

Please let us know if there's anything else we can do.

Best regards,
VIPB Sales Director`}
]},

{id:'exhibition_followup',icon:'🌍',name:'展会后跟进',steps:4,duration:'10天',cat:'exhibition',
desc:'展会结束后自动跟进名片客户',
seq:[
{day:0,ch:'email',subj:'Great Meeting You at the Exhibition! - VIPB',
body:`Dear {contact_name},

It was a pleasure meeting you at the exhibition! Thank you for visiting our booth.

As discussed, I'm sending our digital catalog and price list for your reference.

Looking forward to exploring cooperation with {company_name}.

Best regards,
VIPB International Sales`},
{day:2,ch:'email',subj:'Product Details as Discussed - {product_name}',
body:`Dear {contact_name},

As promised during our meeting, here are the detailed specifications for {product_name}:

📋 Key specs per IEC 62053 / IEC 60898
📋 Full certification documents
📋 Reference installations in {country} region

Please review and let me know which models interest you most.

Best regards,
VIPB Sales Team`},
{day:5,ch:'email',subj:'Free Sample Offer for {company_name}',
body:`Dear {contact_name},

We'd like to offer {company_name} complimentary product samples:

🎁 Sample Options:
• 1x Single Phase Smart Meter
• 1x Three Phase Smart Meter
• Assorted MCB/MCCB samples

Shipping via DHL Express, 5-7 working days.

Shall we arrange the samples?

Best regards,
VIPB Sales Team`},
{day:10,ch:'email',subj:'Visit Arrangement to {country}? - VIPB',
body:`Dear {contact_name},

Our regional manager will visit {country} next month. Would {company_name} be interested in meeting?

We could:
• Present our full product range
• Discuss exclusive distribution terms
• Visit your warehouse/office
• Meet your technical team

Please let me know your availability.

Best regards,
VIPB Regional Director`}
]},

{id:'abandoned_quote_recovery',icon:'💰',name:'废弃报价挽回',steps:4,duration:'45天',cat:'recovery',
desc:'30天未回复的报价自动挽回序列',
seq:[
{day:30,ch:'email',subj:'Checking In - Your {product_name} Quote',
body:`Dear {contact_name},

I noticed we haven't heard back regarding the quotation for {product_name} we sent last month.

I understand decisions take time, especially for larger projects. I wanted to check:
• Are you still evaluating suppliers?
• Did you have concerns about pricing or specs?
• Has the project timeline changed?

We're happy to revise the quotation if your requirements have changed.

Best regards,
VIPB Sales Team`},
{day:35,ch:'email',subj:'Quick Survey - How Can We Improve? - VIPB',
body:`Dear {contact_name},

We value your feedback. Could you spare 30 seconds to let us know why you haven't proceeded?

□ Price too high
□ Specifications don't match
□ Project postponed
□ Chose another supplier
□ Other: ________

Your feedback helps us serve {country} market better. Simply reply with your selection.

Best regards,
VIPB Sales Team`},
{day:38,ch:'email',subj:'🎁 Special Recovery Offer - {product_name}',
body:`Dear {contact_name},

Based on our previous discussions, I'd like to offer a special package:

🎁 Recovery Offer:
• Additional 5% discount on quoted price
• Free shipping for first container (20ft)
• Extended 45-day payment terms
• Free 2-year extended warranty
• Dedicated project manager

This offer is exclusively for {company_name} and valid for 14 days.

Best regards,
VIPB Sales Director`},
{day:45,ch:'email',subj:'Final Offer - {product_name} for {company_name}',
body:`Dear {contact_name},

This is my final attempt regarding the {product_name} quotation.

Our best and final offer includes everything mentioned previously, plus:
• Price match guarantee (if you share a competitive quote)
• Free on-site installation guidance
• 3-year warranty (vs standard 2-year)

If now isn't the right time, we completely understand. We'll keep your file active and reach out when we have new products or promotions.

Best regards,
VIPB Sales Team`}
]},

{id:'order_automation',icon:'📦',name:'订单流程自动化',steps:7,duration:'60天',cat:'fulfillment',
desc:'从订单确认到到港的全流程自动通知',
seq:[
{day:0,ch:'email',subj:'Order Confirmed - {product_name} | PI Attached',
body:`Dear {contact_name},

Thank you! Your order for {product_name} has been confirmed.

📋 Proforma Invoice attached
📋 Order Reference: [Order#]
📋 Payment Terms: 30% T/T within 7 days

Please arrange the deposit payment and send us the bank slip.

Best regards,
VIPB Order Processing`},
{day:3,ch:'email',subj:'Payment Reminder - Deposit Due',
body:`Dear {contact_name},

Friendly reminder: the 30% deposit for your order is due within 7 days of PI date.

Bank Details:
• Bank: [Bank Name]
• Account: [Account#]
• SWIFT: [SWIFT Code]

Once payment is received, production will begin within 48 hours.

Best regards,
VIPB Finance Team`},
{day:15,ch:'email',subj:'Production Update - Your Order in Progress',
body:`Dear {contact_name},

Your order is now in production!

📊 Production Status:
• SMT assembly: Complete
• Calibration: In progress
• Quality testing: Scheduled
• Estimated completion: [Date]

We'll send photos of the production process.

Best regards,
VIPB Production Team`},
{day:25,ch:'email',subj:'Pre-Shipment Inspection Ready - Please Confirm',
body:`Dear {contact_name},

Production is complete. Pre-shipment inspection scheduled.

Options:
• Third-party inspection (SGS/BV/TUV)
• Video inspection via live stream
• Photos + test reports

Please confirm your preferred inspection method and arrange 70% balance.

Best regards,
VIPB QC Team`},
{day:30,ch:'email',subj:'Shipment Dispatched - Tracking Details Inside',
body:`Dear {contact_name},

Great news! Your order has been shipped!

🚢 Shipment Details:
• Vessel: [Vessel Name]
• Container: [Container#]
• ETD: [Date] | ETA: [Date]
• B/L Number: [BL#]

Full shipping documents will be sent via DHL/courier.

Best regards,
VIPB Logistics Team`},
{day:45,ch:'email',subj:'Shipping Documents Sent - {company_name}',
body:`Dear {contact_name},

Original shipping documents dispatched via DHL:
• Bill of Lading (3/3 originals)
• Commercial Invoice
• Packing List
• Certificate of Origin
• Test Reports & Certificates

DHL Tracking: [Tracking#]

Best regards,
VIPB Documentation Team`},
{day:55,ch:'email',subj:'Arrival Notice - Your Order Approaching {country}',
body:`Dear {contact_name},

Your shipment is approaching {country}!

📦 Estimated arrival: [Date]
📦 Port: [Port Name]

Please prepare customs clearance documents. We're here to assist with any customs queries.

Looking forward to your next order!

Best regards,
VIPB Logistics Team`}
]},

{id:'after_sales_care',icon:'⭐',name:'售后关怀序列',steps:4,duration:'90天',cat:'after_sales',
desc:'到货后的安装指南、满意度调查和复购引导',
seq:[
{day:3,ch:'email',subj:'Installation Guide & Technical Support - {product_name}',
body:`Dear {contact_name},

Your {product_name} should have arrived. Here's everything you need for installation:

📚 Resources:
• Installation manual (PDF attached)
• Wiring diagrams
• Configuration guide (for smart meters)
• Video tutorials: [Link]

🔧 Technical Support:
• WhatsApp: +86-xxx-xxxx (24/7)
• Email: support@example.com
• Remote configuration assistance available

Please don't hesitate to contact us for any technical issues.

Best regards,
VIPB Technical Support`},
{day:7,ch:'email',subj:'How Was Your Experience? - Quick Feedback',
body:`Dear {contact_name},

We hope the installation went smoothly! Your feedback is important:

⭐ Quick Rating (1-5):
• Product Quality: ___
• Packaging: ___
• Delivery Time: ___
• Communication: ___
• Overall Satisfaction: ___

💬 Any suggestions for improvement?

Your feedback helps us serve {company_name} better.

Best regards,
VIPB Customer Success Team`},
{day:30,ch:'email',subj:'Accessories & Spare Parts for {product_name}',
body:`Dear {contact_name},

Now that your {product_name} is operational, you might need:

🔧 Popular Accessories:
• Communication modules (GPRS/LoRa/NB-IoT)
• CT sensors (various ratios)
• DIN rail mounting accessories
• Replacement battery packs
• Software licenses (HES/MDM)

📦 Spare Parts:
• Display modules
• Terminal covers
• Sealing accessories

Existing customer discount: 8% off all accessories.

Best regards,
VIPB Parts Department`},
{day:90,ch:'email',subj:'🎁 Reorder Discount for {company_name} - 10% Off',
body:`Dear {contact_name},

It's been 3 months since your last order. We hope everything is working perfectly!

🎁 Loyal Customer Reorder Offer:
• 10% discount on repeat orders
• Same specifications - instant production
• Priority shipping
• Free quality inspection

Simply reply with your quantity and we'll prepare a new PI within 24 hours.

Best regards,
VIPB Sales Team`}
]},

{id:'customer_reactivation',icon:'🔔',name:'客户唤醒序列',steps:4,duration:'120天',cat:'reactivation',
desc:'90天无互动客户的唤醒序列',
seq:[
{day:90,ch:'email',subj:'Industry News: Smart Metering Updates for {country}',
body:`Dear {contact_name},

It's been a while since we last connected. Here are some industry updates relevant to {company_name}:

📰 Key Developments:
• {country} government announces smart grid initiative
• New energy efficiency regulations effective 2025
• Growing demand for prepaid metering solutions
• IEC 62058 testing standard updates

These changes may create new opportunities for your business.

Best regards,
VIPB Market Intelligence`},
{day:100,ch:'email',subj:'New Products You Might Have Missed - VIPB 2025',
body:`Dear {contact_name},

Since we last spoke, VIPB has launched several new products:

🆕 What's New:
• 4G Smart Meter with edge computing
• Smart MCCB with IoT monitoring (WiFi/4G)
• Bi-directional meter for solar applications
• Ultra-compact MCB (18mm width)
• Prepaid meter with mobile app integration

Would any of these be relevant for {company_name}?

Best regards,
VIPB Product Team`},
{day:110,ch:'email',subj:'🎁 We Miss You - Special Comeback Offer',
body:`Dear {contact_name},

We haven't heard from {company_name} in a while and we miss working with you!

🎁 Welcome Back Offer:
• 15% discount on your next order
• Free samples of any new product
• Free freight on orders over $20,000
• Dedicated account manager reassignment

This exclusive offer is valid for 30 days.

Best regards,
VIPB Sales Director`},
{day:120,ch:'email',subj:'Keeping the Door Open - VIPB',
body:`Dear {contact_name},

Just a final note to let you know we're always here for {company_name}.

Whether it's next week, next month, or next year - we'll be ready to:
• Provide competitive quotes within 24 hours
• Ship samples within 48 hours
• Support your projects in {country}

Our product catalog is always available at: [Link]

Wishing you all the best.

Best regards,
VIPB Partnership Team`}
]}
];

// Default scoring rules
const DEFAULT_BEHAVIOR_RULES = [
    {event:'email_open',label:'打开邮件',score:5,icon:'📧'},
    {event:'link_click',label:'点击链接',score:10,icon:'🔗'},
    {event:'page_view',label:'查看产品页',score:15,icon:'👁️'},
    {event:'catalog_download',label:'下载目录',score:20,icon:'📥'},
    {event:'sample_request',label:'索取样品',score:40,icon:'📦'},
    {event:'inquiry_submit',label:'提交询盘',score:50,icon:'📝'},
    {event:'quote_request',label:'请求报价',score:60,icon:'💰'}
];

const DEFAULT_ATTRIBUTE_RULES = [
    {attr:'utility_company',label:'电力公司',score:30,icon:'⚡'},
    {attr:'government_project',label:'政府项目',score:25,icon:'🏛️'},
    {attr:'large_distributor',label:'大型分销商',score:20,icon:'🏢'},
    {attr:'target_market',label:'目标市场国家',score:15,icon:'🌍'},
    {attr:'iec_requirement',label:'有IEC需求',score:10,icon:'📋'}
];
