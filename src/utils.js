function FormatDate(oDate) {
	return oDate.toISOString().slice(0, 10);
}

function IsTodayDate(oDate) {
	return FormatDate(oDate) === FormatDate(new Date());
}

function AddUtcDays(oDate, nDays) {
	const oResult = new Date(oDate);
	oResult.setUTCDate(oResult.getUTCDate() + nDays);
	return oResult;
}

export { AddUtcDays, FormatDate, IsTodayDate };
