
const OFFICE_TZ = 'Asia/Yangon';
const OFFICE_START_HOUR = 10;
const OFFICE_END_HOUR = 18;

function getMyanmarMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: OFFICE_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour').value);
  const minute = Number(parts.find((p) => p.type === 'minute').value);
  return hour * 60 + minute;
}

function isWithinOfficeHours(date = new Date()) {
  const mins = getMyanmarMinutes(date);
  return mins >= OFFICE_START_HOUR * 60 && mins < OFFICE_END_HOUR * 60;
}

function officeHoursMessage() {
  return [
    'ယခု ရုံးချိန် မဟုတ်ပါ။',
    '',
    'တိုက်ရိုက်ဆက်သွယ်ရန် ရုံးချိန်မှာ ဆက်သွယ်နိုင်ပါသည် —',
    'နံနက် ၁၀:၀၀ မှ ညနေ ၆:၀၀ အထိ (Myanmar Time)။',
    '',
    'ကျေးဇူးပြု၍ Contact Form မှတစ်ဆင့် စာပို့ပေးပါ။',
    'ရုံးဖွင့်ချိန်တွင် ပြန်လည်ဆက်သွယ်ပါမည်။',
  ].join('\n');
}

module.exports = {
  OFFICE_TZ,
  OFFICE_START_HOUR,
  OFFICE_END_HOUR,
  getMyanmarMinutes,
  isWithinOfficeHours,
  officeHoursMessage,
};
