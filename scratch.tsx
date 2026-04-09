function formatFieldName(fieldName: string): string {
  let name = fieldName.replace(/\[(\d+)\]/g, (_, num) => ` ${parseInt(num, 10) + 1}`);
  name = name.replace(/\./g, ' - ');
  name = name.replace(/([A-Z])/g, ' $1');
  return name.charAt(0).toUpperCase() + name.slice(1);
}
console.log(formatFieldName("vehicleDefects[0].type"));
console.log(formatFieldName("whatsappConsent"));
