export function success(res, data, message = 'Success', status = 200, extra = {}) {
  return res.status(status).json({ success: true, message, data, ...extra });
}

export function failure(res, message = 'Something went wrong', status = 400) {
  return res.status(status).json({ success: false, message });
}
