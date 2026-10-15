# 3D Pinball game data

The table graphics, collision geometry and rules data are not included; they
belong to Microsoft. Copy them from your own Windows XP installation, from
`C:\Program Files\Windows NT\Pinball\`. File names may be upper or lower case.

| File | Needed | Used for |
|---|---|---|
| `PINBALL.DAT` | yes | The whole table |
| `PINBALL.EXE` | recommended | The bitmap message font (its `PBMSG_FT` resource). Without it, messages use a plain font. |
| `*.WAV` | recommended | Only the clip lengths are read; some game timers wait for a sound to finish. Sound is not played. |

Everything in this folder except this README is ignored by git.
