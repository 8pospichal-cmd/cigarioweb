// Cigario Business — Supabase klient
// Pozn.: anon klíč je VEŘEJNÝ (read-only role 'anon'), je v pořádku v klientu.
// Bezpečnost zajišťuje RLS na serveru, ne skrytí tohoto klíče.
(function () {
  var SUPABASE_URL = 'https://uzdyydevxlzuvdreiprw.supabase.co';
  var SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6ZHl5ZGV2eGx6dXZkcmVpcHJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MTUzNzcsImV4cCI6MjA5MjE5MTM3N30.7cTzAsRbb64eXGAB_GdTj8L8xVSpvghDc5L34I5qVS4';

  // window.supabase = UMD knihovna z CDN; vytvoříme klienta jako window.sb
  window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  });
})();
