/* FAQ chat widget — Telegram-style inline buttons */
(function () {
  const faqData = {
    realEstate: [
      { q: "မြေမဝယ်ခင် Lawyer နဲ့ တိုင်ပင်ဖို့ လိုအပ်ပါသလား?", a: "ဟုတ်ပါတယ်။ ငွေမချေခင် Lawyer နဲ့ တိုင်ပင်ခြင်းက ရောင်းပိုင်ခွင့်၊ စာရွက်စာတမ်း၊ စာချုပ်နဲ့ ဥပဒေရေးရာအန္တရာယ်တွေကို ကြိုတင်စစ်ဆေးနိုင်ပြီး အနာဂတ်အငြင်းပွားမှုတွေကို လျှော့ချပေးနိုင်ပါတယ်။" },
      { q: "စာချုပ်ရှိရုံနဲ့ မြေက လုံခြုံပြီလား?", a: "မဟုတ်ပါ။ စာချုပ်တစ်စောင်ရှိရုံနဲ့ ပိုင်ဆိုင်ခွင့်အာမခံမရပါဘူး။ ရောင်းချသူရဲ့ ရောင်းပိုင်ခွင့်၊ စာရွက်စာတမ်းမှန်ကန်မှု၊ ဥပဒေဆိုင်ရာအခြေအနေတွေကိုလည်း စစ်ဆေးဖို့ လိုအပ်ပါတယ်။" },
      { q: "မြေမှာ ဘဏ်အပေါင်တင်ထားတာကို ဘယ်လိုသိနိုင်မလဲ?", a: "စာရွက်စာတမ်းကြည့်ရုံနဲ့ မသေချာနိုင်ပါဘူး။ သက်ဆိုင်ရာအချက်အလက်တွေကို ဥပဒေနည်းလမ်းအတိုင်း စစ်ဆေးပြီးမှသာ အပေါင်၊ ကန့်သတ်ချက် သို့မဟုတ် အခြားအခွင့်အရေးတွေ ရှိ/မရှိကို သိနိုင်ပါတယ်။" },
      { q: "Deposit ပေးပြီးမှ Due Diligence လုပ်လို့ရလား?", a: "လုပ်လို့ရပေမယ့် အကောင်းဆုံးက Deposit မပေးခင် စစ်ဆေးတာပါ။ Deposit ပေးပြီးမှ ပြဿနာတွေတွေ့ရင် ငွေပြန်ရဖို့ ခက်ခဲနိုင်ပါတယ်။" },
      { q: "Developer Project ကို ဝယ်ရင်လည်း Due Diligence လိုပါသလား?", a: "လိုပါတယ်။ Developer ရဲ့ မြေပိုင်ဆိုင်မှု၊ လုပ်ငန်းလိုင်စင်၊ ခွင့်ပြုချက်များ၊ စာချုပ်အချက်အလက်များကို စစ်ဆေးသင့်ပါတယ်။" },
      { q: "SP, GP, POA ရှိရုံနဲ့ မြေဝယ်လို့ စိတ်ချရလား?", a: "မဟုတ်ပါ။ SP (Special Power), GP (General Power) သို့မဟုတ် POA (Power of Attorney) ရှိရုံနဲ့ မလုံလောက်ပါဘူး။ အဲဒီစာရွက်စာတမ်းတွေက တရားဝင်ဆဲလား၊ ရုပ်သိမ်းထားသလား၊ ပေးပိုင်ခွင့်ဘောင်အတွင်းရှိလားဆိုတာ စစ်ဆေးရပါတယ်။" },
      { q: "အမွေဆိုင်ရာ ပြဿနာရှိတဲ့မြေကို ဘယ်လိုသိနိုင်မလဲ?", a: "ပိုင်ရှင်သေဆုံးထားတာ၊ အမွေဆက်ခံသူများရှိတာ၊ အမွေခွဲဝေမှုမပြီးသေးတာတွေကို စစ်ဆေးဖို့လိုပါတယ်။ ဒီလိုအခြေအနေတွေက နောက်ပိုင်း အမှုဖြစ်နိုင်တဲ့ Risk မြင့်ပါတယ်။" },
      { q: "ရောင်းသူက 'စာရွက်စာတမ်း အကုန်စုံတယ်' လို့ပြောရင် ယုံလို့ရလား?", a: "စာရွက်စာတမ်းစုံတာနဲ့ ဥပဒေအရ အန္တရာယ်မရှိဘူးလို့ မဆိုနိုင်ပါဘူး။ စာရွက်စာတမ်းရဲ့ တရားဝင်မှု၊ ရောင်းပိုင်ခွင့်နဲ့ လက်ရှိဥပဒေအခြေအနေတွေကို သီးခြားစစ်ဆေးဖို့ လိုပါတယ်။" },
      { q: "Real Estate Due Diligence မှာ ဘာတွေ ပါဝင်လဲ?", a: "ဝန်ဆောင်မှုအတိုင်းအတာပေါ်မူတည်ပေမယ့် အများအားဖြင့်— ပိုင်ဆိုင်မှုစစ်ဆေးခြင်း၊ ရောင်းပိုင်ခွင့်စစ်ဆေးခြင်း၊ စာချုပ်သုံးသပ်ခြင်း၊ ဥပဒေရေးရာ Risk Assessment၊ လိုအပ်သော အကြံပြုချက်များ တို့ ပါဝင်ပါတယ်။" },
      { q: "Lawyer ကို မခန့်ဘဲ ဝယ်ရင် ဘာ Risk ရှိနိုင်လဲ?", a: "ငွေဆုံးရှုံးမှု၊ ရောင်းပိုင်ခွင့်မပြည့်စုံခြင်း၊ အမွေဆိုင်ရာအငြင်းပွားမှု၊ ဘဏ်အပေါင်၊ တရားရုံးအမှု၊ စာချုပ်အားနည်းချက်တွေကြောင့် အချိန်နဲ့ ငွေကြေးပိုမိုဆုံးရှုံးနိုင်ပါတယ်။" }
    ],
    businessLaw: [
      { q: "Company တည်ထောင်ဖို့ Lawyer လိုအပ်ပါသလား?", a: "Company Registration ကို ကိုယ်တိုင်လုပ်နိုင်သော်လည်း Share Structure၊ Director Responsibilities၊ Internal Agreements နဲ့ Legal Compliance တွေကို အစကတည်းက မှန်ကန်အောင် စီစဉ်ထားဖို့ Lawyer နဲ့ တိုင်ပင်တာက နောင်တစ်ချိန်မှာ ဖြစ်လာနိုင်တဲ့ ဥပဒေရေးရာပြဿနာတွေကို လျှော့ချပေးနိုင်ပါတယ်။" },
      { q: "Company Registration ပြီးရုံနဲ့ တရားဝင်လုပ်ငန်းစလုပ်လို့ ရပြီလား?", a: "အမြဲတမ်း မဟုတ်ပါ။ လုပ်ငန်းအမျိုးအစားပေါ်မူတည်ပြီး လိုအပ်တဲ့ Licences, Permits, Regulatory Approvals နဲ့ Tax Registration တွေကိုလည်း ဆောင်ရွက်ရနိုင်ပါတယ်။" },
      { q: "Business Contract ကို Internet က Sample ယူသုံးလို့ ရပါသလား?", a: "Sample Contract တွေဟာ သင့်လုပ်ငန်းအခြေအနေနဲ့ မကိုက်ညီနိုင်ပါဘူး။ စာချုပ်တစ်စောင်ဟာ လုပ်ငန်းရဲ့ ရည်ရွယ်ချက်၊ Risk နဲ့ သက်ဆိုင်ရာဥပဒေကို ထည့်သွင်းရေးဆွဲထားမှ အကာအကွယ်ကောင်းကောင်း ရရှိနိုင်ပါတယ်။" },
      { q: "NDA (Non-Disclosure Agreement) က ဘယ်အချိန်မှာ လိုအပ်သလဲ?", a: "Business Idea၊ Customer List၊ Financial Information၊ Trade Secret၊ Software၊ Formula နဲ့ Confidential Information တွေကို အခြားသူထံ မျှဝေမီ NDA ချုပ်ဆိုထားသင့်ပါတယ်။" },
      { q: "Shareholder Agreement က ဘာကြောင့် အရေးကြီးတာလဲ?", a: "Shareholder Agreement က Shareholders တွေရဲ့ အခွင့်အရေး၊ တာဝန်၊ အမြတ်ခွဲဝေမှု၊ Share Transfer နဲ့ Dispute Resolution ကို ကြိုတင်သတ်မှတ်ထားတာကြောင့် နောင်ဖြစ်လာနိုင်တဲ့ အငြင်းပွားမှုတွေကို လျှော့ချပေးပါတယ်။" },
      { q: "Business Partner ကို ယုံကြည်ရင် စာချုပ်မလိုဘူးလား?", a: "ယုံကြည်မှုက အရေးကြီးပေမယ့် စာချုပ်က ပိုအရေးကြီးပါတယ်။ စာချုပ်ဟာ ယုံကြည်မှုမရှိလို့ ချုပ်တာမဟုတ်ဘဲ နှစ်ဖက်စလုံးရဲ့ အခွင့်အရေးနဲ့ တာဝန်တွေကို ရှင်းလင်းစေဖို့ ဖြစ်ပါတယ်။" },
      { q: "Contract Review Service ဆိုတာ ဘာလဲ?", a: "Contract Review Service ဆိုတာ စာချုပ်ထဲက အန္တရာယ်ရှိနိုင်တဲ့ Clause တွေ၊ မမျှတတဲ့ သဘောတူညီချက်တွေ၊ ပြင်ဆင်သင့်တဲ့ အချက်တွေကို Lawyer က သုံးသပ်ပြီး အကြံပြုပေးတဲ့ ဝန်ဆောင်မှုဖြစ်ပါတယ်။" },
      { q: "Lawyer နဲ့ တိုင်ပင်ထားတဲ့ အချက်အလက်တွေကို လျှို့ဝှက်ထားပေးပါသလား?", a: "ဟုတ်ပါတယ်။ Client ထံမှ ရရှိတဲ့ အချက်အလက်တွေကို Professional Confidentiality အရ လျှို့ဝှက်ထိန်းသိမ်းပေးပြီး၊ Client ရဲ့ သဘောတူညီချက်မရှိဘဲ အခြားသူထံ ထုတ်ဖော်မည် မဟုတ်ပါ။" },
      { q: "Startup လုပ်ငန်းအသစ်တစ်ခု စတင်မယ်ဆိုရင် ဘယ်လို ဥပဒေရေးရာ ပြင်ဆင်မှုတွေ လိုအပ်လဲ?", a: "Business Structure ရွေးချယ်ခြင်း၊ Company Registration၊ Shareholder Agreement၊ Employment Contract၊ NDA၊ Trademark Registration၊ Tax Compliance နဲ့ လုပ်ငန်းလိုင်စင်များကို လုပ်ငန်းအမျိုးအစားအလိုက် စီစဉ်သင့်ပါတယ်။" },
      { q: "Legal Consultation ကို Online ရနိုင်ပါသလား?", a: "ရပါတယ်။ Appointment ရယူပြီး Video Call သို့မဟုတ် Online Meeting မှတစ်ဆင့် မြန်မာနိုင်ငံအတွင်းနှင့် ပြည်ပရောက် Clients များကိုလည်း ဝန်ဆောင်မှုပေးလျက်ရှိပါတယ်။" }
    ],
    companyLaw: [
      { q: "Company Registration လုပ်ပြီးရုံနဲ့ လုပ်ငန်းစတင်လို့ ရပြီလား?", a: "မဟုတ်ပါ။ Company Registration ပြီးတာဟာ စတင်ခြေလှမ်းတစ်ခုသာ ဖြစ်ပါတယ်။ လုပ်ငန်းအမျိုးအစားပေါ်မူတည်ပြီး လိုအပ်တဲ့ Licences, Permits, Tax Registration နဲ့ Regulatory Compliance တွေကို ဆက်လက်ဆောင်ရွက်ရန် လိုအပ်နိုင်ပါတယ်။" },
      { q: "Private Company နဲ့ Public Company က ဘာကွာခြားလဲ?", a: "Private Company က အစုရှယ်ယာလွှဲပြောင်းခြင်းနဲ့ အများပြည်သူထံမှ ရင်းနှီးမြှုပ်နှံငွေစုဆောင်းခြင်းအပေါ် ကန့်သတ်ချက်များ ရှိနိုင်ပါတယ်။ Public Company ကတော့ ဥပဒေသတ်မှတ်ချက်များကို လိုက်နာပြီး အများပြည်သူထံမှ ရင်းနှီးမြှုပ်နှံငွေ ရယူနိုင်တဲ့ ပုံစံဖြစ်ပါတယ်။" },
      { q: "Director တစ်ယောက်မှာ ဘာတာဝန်တွေရှိလဲ?", a: "Director ဟာ Company နဲ့ Shareholders တွေရဲ့ အကျိုးစီးပွားကို ဦးစားပေးပြီး ဥပဒေနဲ့အညီ၊ ရိုးသားစွာ စီမံခန့်ခွဲရမယ့် Fiduciary Duties နဲ့ Statutory Duties တွေကို ထမ်းဆောင်ရပါတယ်။" },
      { q: "Shareholder Agreement မရှိရင် ဘာဖြစ်နိုင်လဲ?", a: "Share Transfer၊ Voting Rights၊ Profit Distribution၊ Decision Making နဲ့ Exit Plan စတဲ့ အရေးကြီးတဲ့ကိစ္စတွေမှာ သဘောထားကွဲလွဲမှု ဖြစ်နိုင်ပြီး ဖြေရှင်းရ ပိုမိုခက်ခဲနိုင်ပါတယ်။" },
      { q: "Company မှာ Share အသစ်ထုတ်ပေးချင်ရင် ဘာလုပ်ရမလဲ?", a: "Company Constitution၊ Shareholders' Resolution၊ Directors' Resolution နဲ့ သက်ဆိုင်ရာ ဥပဒေသတ်မှတ်ချက်များကို လိုက်နာပြီး ဆောင်ရွက်ရပါတယ်။" },
      { q: "Share Transfer လုပ်တဲ့အခါ ဘာတွေစစ်ဆေးသင့်လဲ?", a: "Share Transfer မပြုလုပ်မီ Shareholder Agreement၊ Company Constitution၊ Existing Share Rights နဲ့ ဥပဒေဆိုင်ရာ လိုအပ်ချက်များကို စစ်ဆေးသင့်ပါတယ်။" },
      { q: "Foreign Investor က မြန်မာ Company မှာ ရင်းနှီးမြှုပ်နှံလို့ရလား?", a: "ရင်းနှီးမြှုပ်နှံနိုင်တဲ့ လုပ်ငန်းအမျိုးအစားများလည်း ရှိသလို ကန့်သတ်ထားတဲ့ လုပ်ငန်းများလည်း ရှိပါတယ်။ လုပ်ငန်းအမျိုးအစား၊ ရင်းနှီးမြှုပ်နှံမှုပုံစံနဲ့ သက်ဆိုင်ရာ ဥပဒေများကို သီးခြားသုံးသပ်ဖို့ လိုအပ်ပါတယ်။" },
      { q: "Company Constitution က မဖြစ်မနေ လိုအပ်ပါသလား?", a: "Company Constitution ရှိခြင်းက Company ရဲ့ စီမံခန့်ခွဲမှု၊ Shareholder Rights နဲ့ Internal Governance ကို ပိုမိုရှင်းလင်းစေပါတယ်။ လုပ်ငန်းအရွယ်အစားကြီးလာလေ အရေးပါလာလေ ဖြစ်ပါတယ်။" },
      { q: "Annual Return မတင်ရင် ဘာဖြစ်နိုင်လဲ?", a: "ဥပဒေအရ လိုအပ်တဲ့ Annual Return နဲ့ အခြား Statutory Filing တွေကို အချိန်မီ မတင်ပါက ဒဏ်ကြေး၊ Compliance ပြဿနာ သို့မဟုတ် Company Status အပေါ် သက်ရောက်မှုတွေ ဖြစ်နိုင်ပါတယ်။" },
      { q: "Company ကို Legal Retainer နဲ့ Lawyer ခန့်ထားဖို့ လိုအပ်လား?", a: "လုပ်ငန်းမှာ Contract Review၊ Employment Issues၊ Compliance၊ Corporate Governance နဲ့ Legal Risk Management တွေကို ဆက်တိုက် ကြုံတွေ့ရတဲ့ Company တွေအတွက် Legal Retainer Service က ဥပဒေရေးရာအန္တရာယ်တွေကို ကြိုတင်ကာကွယ်ပေးပြီး ဆုံးဖြတ်ချက်တွေကို ပိုမိုလုံခြုံစေပါတယ်။" }
    ],
    contractLaw: [
      { q: "Contract (စာချုပ်) တစ်စောင် မဖြစ်မနေ လိုအပ်ပါသလား?", a: "အရေးကြီးတဲ့ စီးပွားရေးသဘောတူညီချက်၊ ငွေကြေးပေးချေမှု၊ ပစ္စည်းရောင်းဝယ်မှု၊ ဝန်ဆောင်မှုပေးခြင်း၊ Partnership သို့မဟုတ် Investment ကိစ္စများတွင် စာချုပ်ရှိခြင်းက နှစ်ဖက်စလုံး၏ အခွင့်အရေးနှင့် တာဝန်များကို ရှင်းလင်းစေပြီး ဥပဒေရေးရာအန္တရာယ်များကို လျှော့ချပေးနိုင်ပါတယ်။" },
      { q: "Internet က Sample Contract ကို အသုံးပြုလို့ ရပါသလား?", a: "Sample Contract များကို အခြေခံအနေနဲ့ ကြည့်ရှုနိုင်ပေမယ့် လုပ်ငန်းအမျိုးအစား၊ ဥပဒေ၊ သဘောတူညီချက်နဲ့ အန္တရာယ်များ မတူညီတဲ့အတွက် တိုက်ရိုက်အသုံးပြုခြင်းက အန္တရာယ်ရှိနိုင်ပါတယ်။ သင့်အခြေအနေနဲ့ ကိုက်ညီအောင် ရေးဆွဲထားတဲ့ Contract က ပိုမိုလုံခြုံပါတယ်။" },
      { q: "Contract ကို Lawyer က Review လုပ်ပေးဖို့ ဘာကြောင့်လိုအပ်တာလဲ?", a: "Contract Review က မမျှတတဲ့ Clause များ၊ ဥပဒေနဲ့ မကိုက်ညီတဲ့ အချက်များ၊ ငွေကြေးဆုံးရှုံးစေနိုင်တဲ့ Risk များ၊ Termination နဲ့ Dispute Resolution Clause များ၊ ပြင်ဆင်သင့်တဲ့ အချက်များကို စစ်ဆေးပေးပါတယ်။" },
      { q: "နှစ်ဖက်လက်မှတ်ထိုးပြီးရင် Contract ကို ပြင်ဆင်လို့ ရသေးလား?", a: "ရပါတယ်။ သို့သော် နှစ်ဖက်စလုံးရဲ့ သဘောတူညီချက်နဲ့ Amendment Agreement သို့မဟုတ် Addendum အဖြစ် တရားဝင်ပြင်ဆင်သင့်ပါတယ်။" },
      { q: "စာချုပ်ကို Notary Public မှာ မှတ်ပုံတင်ရမလား?", a: "Contract အမျိုးအစားပေါ် မူတည်ပါတယ်။ Contract တိုင်း Notarization လုပ်ရန် မလိုအပ်သော်လည်း အချို့သော သဘောတူညီချက်များတွင် သက်သေအထောက်အထားပိုမိုခိုင်မာစေရန် Notarization ပြုလုပ်နိုင်ပါတယ်။" },
      { q: "မြန်မာဘာသာနဲ့ အင်္ဂလိပ်ဘာသာ နှစ်မျိုးလုံးရေးဖို့ လိုပါသလား?", a: "International Transaction၊ Foreign Partner၊ Foreign Investor နဲ့ ချုပ်ဆိုတဲ့ Contract များတွင် Bilingual Contract (Myanmar–English) အသုံးပြုခြင်းက ပိုမိုရှင်းလင်းပြီး အနာဂတ်အငြင်းပွားမှုများကို လျှော့ချပေးနိုင်ပါတယ်။" },
      { q: "Contract မှာ မဖြစ်မနေ ပါသင့်တဲ့ အချက်တွေက ဘာတွေလဲ?", a: "Contract အမျိုးအစားပေါ် မူတည်ပေမယ့် အများအားဖြင့်— Parties၊ Scope of Work၊ Payment Terms၊ Rights & Obligations၊ Confidentiality၊ Intellectual Property၊ Term & Termination၊ Governing Law၊ Dispute Resolution၊ Force Majeure စတဲ့ အချက်တွေ ပါဝင်သင့်ပါတယ်။" },
      { q: "NDA (Non-Disclosure Agreement) ကို ဘယ်အချိန်မှာ ချုပ်သင့်လဲ?", a: "Business Idea၊ Customer Data၊ Formula၊ Software၊ Financial Information၊ Trade Secret သို့မဟုတ် Confidential Information တွေကို အခြားသူနဲ့ မျှဝေမီ NDA ချုပ်ဆိုထားသင့်ပါတယ်။" },
      { q: "Contract ကို လက်မှတ်မထိုးခင် ဘာတွေစစ်ဆေးသင့်လဲ?", a: "လက်မှတ်မထိုးမီ အဖွဲ့အစည်း/လူပုဂ္ဂိုလ်၏ တရားဝင်အခြေအနေ၊ စာချုပ်ပါ တာဝန်များ၊ ငွေပေးချေမှုစည်းကမ်းများ၊ Penalty Clause၊ Termination Clause၊ Dispute Resolution၊ Governing Law တို့ကို စစ်ဆေးသင့်ပါတယ်။" },
      { q: "Contract ချိုးဖောက်ခံရရင် ဘာလုပ်နိုင်လဲ?", a: "Contract ပါ အချက်အလက်များနဲ့ သက်ဆိုင်ရာဥပဒေအရ အခွင့်အရေးများကို အသုံးပြုနိုင်ပါတယ်။ အခြေအနေပေါ်မူတည်ပြီး Negotiation၊ Mediation၊ Arbitration သို့မဟုတ် တရားစွဲဆိုခြင်းကဲ့သို့သော နည်းလမ်းများကို ရွေးချယ်နိုင်ပါတယ်။" }
    ]
  };

  const categories = [
    { id: 'realEstate', label: 'Real Estate FAQ' },
    { id: 'businessLaw', label: 'Business Law FAQ' },
    { id: 'companyLaw', label: 'Company Law FAQ' },
    { id: 'contractLaw', label: 'Contract Law FAQ' }
  ];

  function initChat() {
    const root = document.getElementById('chat-widget');
    const panel = document.getElementById('chat-panel');
    const launcher = document.getElementById('chat-launcher');
    const messages = document.getElementById('chat-messages');
    const form = document.getElementById('chat-compose');
    const input = document.getElementById('chat-input');
    if (!root || !panel || !launcher || !messages) return;

    const closeBtn = panel.querySelector('.chat-close');
    const backBtn = panel.querySelector('.chat-back');
    let currentCatId = null;

    function scrollToBottom() {
      messages.scrollTop = messages.scrollHeight;
    }

    function appendBubble(text, who) {
      const el = document.createElement('div');
      el.className = 'chat-bubble ' + who;
      el.textContent = text;
      messages.appendChild(el);
      scrollToBottom();
      return el;
    }

    function disableLastKeyboard() {
      messages.querySelectorAll('.chat-inline-kb:not(.is-used)').forEach((kb) => {
        kb.classList.add('is-used');
        kb.querySelectorAll('button').forEach((btn) => {
          btn.disabled = true;
        });
      });
    }

    function appendKeyboard(buttons) {
      disableLastKeyboard();
      const kb = document.createElement('div');
      kb.className = 'chat-inline-kb';
      buttons.forEach(({ label, onClick, isBack }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = isBack ? 'chat-inline-btn is-back' : 'chat-inline-btn';
        btn.textContent = label;
        btn.addEventListener('click', () => {
          if (kb.classList.contains('is-used')) return;
          onClick();
        });
        kb.appendChild(btn);
      });
      messages.appendChild(kb);
      scrollToBottom();
      return kb;
    }

    function setBackVisible(show) {
      if (!backBtn) return;
      backBtn.hidden = !show;
    }

    function goMainMenu(greeting) {
      currentCatId = null;
      setBackVisible(false);
      showMainMenu(greeting);
    }

    function showMainMenu(greeting = "မင်္ဂလာပါ။ Shwe Lone Myanmar မှ ကြိုဆိုပါတယ်။ ဘယ်အကြောင်းအရာကို သိချင်ပါသလဲ?") {
      appendBubble(greeting, 'bot');
      appendKeyboard(
        categories.map((cat) => ({
          label: cat.label,
          onClick: () => handleCategorySelect(cat),
        }))
      );
    }

    function handleCategorySelect(cat) {
      appendBubble(cat.label, 'user');
      currentCatId = cat.id;
      setBackVisible(true);

      const data = faqData[cat.id];
      if (!data || data.length === 0) {
        setTimeout(() => {
          appendBubble('ဒီအကြောင်းအရာအတွက် FAQ များကို မကြာမီ ထည့်သွင်းပေးပါမည်။', 'bot');
          setTimeout(() => goMainMenu('အခြား ဘယ်အကြောင်းအရာကို သိချင်ပါသလဲ?'), 900);
        }, 350);
        return;
      }

      setTimeout(() => {
        appendBubble(cat.label + ' နဲ့ ပတ်သက်ပြီး အောက်ပါမေးခွန်းများကို ရွေးချယ်မေးမြန်းနိုင်ပါတယ်။', 'bot');
        showQuestions(cat.id);
      }, 350);
    }

    function showQuestions(catId) {
      const data = faqData[catId] || [];
      appendKeyboard([
        ...data.map((item) => ({
          label: item.q,
          onClick: () => handleQuestionSelect(item.q, item.a, catId),
        })),
        {
          label: '← နောက်သို့ (Main Menu)',
          isBack: true,
          onClick: () => goMainMenu('ဘယ်အကြောင်းအရာကို သိချင်ပါသလဲ?'),
        },
      ]);
    }

    function handleQuestionSelect(q, a, catId) {
      appendBubble(q, 'user');
      setTimeout(() => {
        const answerEl = appendBubble(a, 'bot');
        // Keep answer visible at bottom — don't dump full question list under it
        appendKeyboard([
          {
            label: 'မေးခွန်းများ ထပ်ရွေးရန်',
            onClick: () => showQuestions(catId),
          },
          {
            label: '← နောက်သို့ (Main Menu)',
            isBack: true,
            onClick: () => goMainMenu('ဘယ်အကြောင်းအရာကို သိချင်ပါသလဲ?'),
          },
        ]);
        // Scroll so the answer sits near the top of the visible chat area
        window.setTimeout(() => {
          answerEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
      }, 350);
    }

    function setOpen(open) {
      if (open) {
        panel.removeAttribute('hidden');
        panel.style.display = 'flex';
        root.classList.add('is-open');
        launcher.setAttribute('aria-expanded', 'true');
        if (messages.children.length === 0) {
          showMainMenu();
        }
        scrollToBottom();
        window.setTimeout(() => input && input.focus(), 80);
        if (window.lenis) window.lenis.stop();
        document.body.style.overflow = 'hidden';
      } else {
        panel.setAttribute('hidden', '');
        panel.style.display = 'none';
        root.classList.remove('is-open');
        launcher.setAttribute('aria-expanded', 'false');
        if (window.lenis) window.lenis.start();
        document.body.style.overflow = '';
      }
    }

    setOpen(false);

    launcher.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOpen(!root.classList.contains('is-open'));
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      });
    }

    if (backBtn) {
      backBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        goMainMenu('ဘယ်အကြောင်းအရာကို သိချင်ပါသလဲ?');
      });
    }

    const bookLink = panel.querySelector('.chat-head-link');
    if (bookLink) {
      bookLink.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        const target = document.querySelector('#contact');
        if (!target) return;
        window.setTimeout(() => {
          if (window.lenis) {
            window.lenis.scrollTo(target, { offset: -96 });
          } else {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 80);
      });
    }

    function saveMessage(message) {
      try {
        const list = JSON.parse(localStorage.getItem('shwelone_chat_messages') || '[]');
        list.push({
          id: Date.now(),
          name: 'Guest',
          message,
          source: 'ask-us',
          createdAt: new Date().toISOString(),
        });
        localStorage.setItem('shwelone_chat_messages', JSON.stringify(list));
      } catch (_) {
        /* ignore */
      }
    }

    function sendMessage() {
      if (!input) return;
      const text = (input.value || '').trim();
      if (!text) return;

      appendBubble(text, 'user');
      saveMessage(text);
      input.value = '';
      input.style.height = 'auto';

      window.setTimeout(() => {
        appendBubble(
          'ကျေးဇူးတင်ပါသည်။ သင့်မေးခွန်းကို လက်ခံရရှိပါပြီ။ ရုံးမှ တစ်ရက်အတွင်း ပြန်လည်ဆက်သွယ်ပါမည်။ အောက်ပါ FAQ မှလည်း ရွေးမေးနိုင်ပါသည်။',
          'bot'
        );
        currentCatId = null;
        setBackVisible(false);
        appendKeyboard(
          categories.map((cat) => ({
            label: cat.label,
            onClick: () => handleCategorySelect(cat),
          }))
        );
      }, 450);
    }

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMessage();
      });
    }

    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 80) + 'px';
      });
    }

    // Prevent page scroll while hovering chat messages
    messages.addEventListener(
      'wheel',
      (e) => {
        e.stopPropagation();
      },
      { passive: true }
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChat);
  } else {
    initChat();
  }
})();
