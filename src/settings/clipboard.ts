export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);

    return;
  } catch {
    // fall through to the execCommand fallback below
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';

  document.body.appendChild(area);
  area.select();

  try {
    document.execCommand('copy');
  } catch {
    // clipboard unavailable
  }

  area.remove();
}
