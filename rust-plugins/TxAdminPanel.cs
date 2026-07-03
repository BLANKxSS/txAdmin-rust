using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Oxide.Core.Plugins;
using Oxide.Game.Rust.Cui;
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Oxide.Plugins;

[Info("TxAdminPanel", "txAdmin", "1.0.0")]
[Description("Displays scheduled restart countdown and announcements from txAdmin")]
public class TxAdminPanel : RustPlugin
{
    #region Class Fields

    [PluginReference] private readonly Plugin MagicPanel;

    private long _restartTs = 0; // Unix milliseconds, 0 = no restart scheduled
    private enum UpdateEnum { All = 1, Panel = 2, Image = 3, Text = 4 }
    private const string AnnouncementUiName = "TxAdminPanel_Announcement";

    #endregion

    #region Setup & Loading

    private void OnServerInitialized()
    {
        MagicPanelRegisterPanels();
        timer.Every(30f, UpdateRestartCountdown);
    }

    private void Unload()
    {
        foreach (BasePlayer player in BasePlayer.activePlayerList)
        {
            CuiHelper.DestroyUi(player, AnnouncementUiName);
        }
    }

    private void OnPlayerDisconnected(BasePlayer player, string reason)
    {
        CuiHelper.DestroyUi(player, AnnouncementUiName);
    }

    #endregion

    #region MagicPanel Integration

    private void MagicPanelRegisterPanels()
    {
        if (MagicPanel?.IsLoaded is not true)
        {
            PrintWarning("MagicPanel not loaded");
            return;
        }

        var panelSettings = new PanelRegistration
        {
            BackgroundColor = "#FFF2DF08",
            Dock = "leftbottom",
            Order = 0,
            Width = 0.075f
        };

        MagicPanel?.Call("RegisterGlobalPanel", this, Name,
            JsonConvert.SerializeObject(panelSettings), nameof(GetPanel));
    }

    private Hash<string, object> GetPanel()
    {
        var panel = new Panel
        {
            Image = new PanelImage
            {
                Enabled = false,
                Color = "#FFFFFFFF",
                Order = 1,
                Width = 0f,
                Url = "",
                Padding = new TypePadding(0f, 0f, 0f, 0f)
            },
            Text = new PanelText
            {
                Enabled = true,
                Color = "#FFFF00FF",
                Order = 0,
                Width = 1.0f,
                FontSize = 12,
                Padding = new TypePadding(0.05f, 0.05f, 0.05f, 0.05f),
                TextAnchor = TextAnchor.MiddleCenter,
                Text = GetRestartCountdownText()
            }
        };

        return panel.ToHash();
    }

    // ponytail: MagicPanel's HidePanel doesn't destroy already-drawn UI
    // (DrawGlobalPanel early-returns on info.All without a DestroyUi),
    // so "hidden" here = empty text on a near-transparent panel.
    private void UpdateRestartCountdown()
    {
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (_restartTs > 0 && _restartTs <= now)
        {
            _restartTs = 0; // expired; fall through for one last update that clears the text
        }
        else if (_restartTs <= 0)
        {
            return; // nothing scheduled, text already empty
        }

        MagicPanel?.Call("UpdatePanel", Name, (int)UpdateEnum.Text);
    }

    private string GetRestartCountdownText()
    {
        if (_restartTs <= 0)
            return "";

        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        long remaining = _restartTs - now;

        if (remaining <= 0)
            return "";

        long seconds = remaining / 1000;
        long hours = seconds / 3600;
        long minutes = (seconds % 3600) / 60;

        if (hours > 0)
            return $"Restart {hours}h{minutes}m";
        else if (minutes > 0)
            return $"Restart {minutes}m{seconds % 60}s";
        else
            return $"Restart {seconds}s";
    }

    #endregion

    #region Console Commands

    [ConsoleCommand("txadminpanel.setrestart")]
    private void CmdSetRestart(ConsoleSystem.Arg arg)
    {
        if (arg.Player() != null)
        {
            arg.ReplyWith("Server console/RCON only");
            return;
        }

        if (arg.Args == null || arg.Args.Length == 0)
        {
            Puts("Usage: txadminpanel.setrestart <unixMs|off>");
            return;
        }

        string param = arg.GetString(0);

        if (param.ToLower() == "off")
        {
            _restartTs = 0;
            MagicPanel?.Call("UpdatePanel", Name, (int)UpdateEnum.Text); // clears text
            Puts("Restart countdown cleared");
            return;
        }

        if (long.TryParse(param, out long ts))
        {
            _restartTs = ts;
            UpdateRestartCountdown();
            Puts($"Restart scheduled for {ts}");
        }
        else
        {
            Puts("Invalid timestamp");
        }
    }

    [ConsoleCommand("txadminpanel.announce")]
    private void CmdAnnounce(ConsoleSystem.Arg arg)
    {
        if (arg.Player() != null)
        {
            arg.ReplyWith("Server console/RCON only");
            return;
        }

        if (arg.Args == null || arg.Args.Length == 0)
        {
            Puts("Usage: txadminpanel.announce <message...>");
            return;
        }

        // RCON sends quoted message as single arg[0]; unquoted words arrive as multiple args
        string message = arg.Args.Length == 1 ? arg.GetString(0) : string.Join(" ", arg.Args);

        Puts($"Announcement: {message}");
        ShowAnnouncement(message);
    }

    #endregion

    #region Announcements

    private void ShowAnnouncement(string message)
    {
        // Clear existing announcement
        foreach (BasePlayer player in BasePlayer.activePlayerList)
        {
            CuiHelper.DestroyUi(player, AnnouncementUiName);
        }

        // Create banner UI
        var container = new CuiElementContainer();
        container.Add(new CuiPanel
        {
            Image = { Color = "0 0 0 0.8" },
            RectTransform = { AnchorMin = "0.2 0.83", AnchorMax = "0.8 0.93" }
        }, "Overlay", AnnouncementUiName);

        container.Add(new CuiLabel
        {
            Text = { Text = message, FontSize = 18, Align = TextAnchor.MiddleCenter, Color = "1 1 1 1" },
            RectTransform = { AnchorMin = "0 0", AnchorMax = "1 1" }
        }, AnnouncementUiName);

        // Send to all active players
        foreach (BasePlayer player in BasePlayer.activePlayerList)
        {
            CuiHelper.AddUi(player, container);
        }

        // Auto-destroy after 15 seconds
        timer.In(15f, () =>
        {
            foreach (BasePlayer player in BasePlayer.activePlayerList)
            {
                CuiHelper.DestroyUi(player, AnnouncementUiName);
            }
        });
    }

    #endregion

    #region Classes

    private sealed class PanelRegistration
    {
        public string Dock { get; set; }
        public float Width { get; set; }
        public int Order { get; set; }
        public string BackgroundColor { get; set; }
    }

    private sealed class Panel
    {
        public PanelImage Image { get; set; }
        public PanelText Text { get; set; }

        [JsonIgnore] private Hash<string, object> _hash;

        public Hash<string, object> ToHash()
        {
            _hash ??= new Hash<string, object>
            {
                [nameof(Image)] = Image.ToHash()
            };
            _hash[nameof(Text)] = Text.ToHash();
            return _hash;
        }
    }

    private abstract class PanelType
    {
        public bool Enabled { get; set; }
        public string Color { get; set; }
        public int Order { get; set; }
        public float Width { get; set; }
        public TypePadding Padding { get; set; }

        [JsonIgnore] private Hash<string, object> _hash;

        public virtual Hash<string, object> ToHash()
        {
            _hash ??= new Hash<string, object>
            {
                [nameof(Enabled)] = Enabled,
                [nameof(Color)] = Color,
                [nameof(Order)] = Order,
                [nameof(Width)] = Width,
                [nameof(Padding)] = Padding.ToHash()
            };
            return _hash;
        }
    }

    private sealed class PanelImage : PanelType
    {
        public string Url { get; set; }

        public override Hash<string, object> ToHash()
        {
            Hash<string, object> hash = base.ToHash();
            hash.TryAdd(nameof(Url), Url);
            return hash;
        }
    }

    private sealed class PanelText : PanelType
    {
        public string Text { get; set; }
        public int FontSize { get; set; }

        [JsonConverter(typeof(StringEnumConverter))]
        public TextAnchor TextAnchor { get; set; }

        public override Hash<string, object> ToHash()
        {
            Hash<string, object> hash = base.ToHash();
            hash[nameof(Text)] = Text;
            hash.TryAdd(nameof(FontSize), FontSize);
            hash.TryAdd(nameof(TextAnchor), TextAnchor);
            return hash;
        }
    }

    private sealed class TypePadding
    {
        public float Left { get; set; }
        public float Right { get; set; }
        public float Top { get; set; }
        public float Bottom { get; set; }

        [JsonIgnore] private Hash<string, object> _hash;

        public TypePadding(float left, float right, float top, float bottom)
        {
            Left = left;
            Right = right;
            Top = top;
            Bottom = bottom;
        }

        public Hash<string, object> ToHash()
        {
            _hash ??= new Hash<string, object>
            {
                [nameof(Left)] = Left,
                [nameof(Right)] = Right,
                [nameof(Top)] = Top,
                [nameof(Bottom)] = Bottom
            };
            return _hash;
        }
    }

    #endregion
}
