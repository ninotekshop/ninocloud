# NinoPOS Technician Tool

This tool never displays or recovers passwords. It authenticates a technician, lists non-sensitive account metadata, and generates a one-time Admin password-reset code.

Configure the technician secret outside the repository:

```powershell
$env:NINOPOS_TECHNICIAN_KEY = "use-a-long-random-secret"
npm start
```

Run from `tools\technician-tool`. The reset code expires after 15 minutes and is entered through **Quên mật khẩu Admin?** in NinoPOS.
