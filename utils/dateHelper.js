const moment = require('moment');

exports.isValidPublishDate = (date, isUpdate = false) => {
  const publishDate = moment(date);
  const now = moment();

  if (!publishDate.isValid()) {
    return false;
  }

  if (isUpdate) {
    // Untuk update, izinkan tanggal yang sama
    return publishDate.isSameOrAfter(now, 'minute');
  }
  
  // Untuk create, harus setelah waktu sekarang
  return publishDate.isAfter(now, 'minute');
}; 