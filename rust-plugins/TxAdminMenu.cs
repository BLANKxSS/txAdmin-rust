using System;
using System.Collections.Generic;
using System.Linq;
using Oxide.Core;
using Oxide.Game.Rust.Cui;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("TxAdminMenu", "txAdmin", "1.0.0")]
    [Description("In-game admin menu for player management")]
    class TxAdminMenu : RustPlugin
    {
        private const string PermissionUse = "txadminmenu.use";
        private const string PanelName = "TxAdminMenuPanel";
        private const int PlayersPerPage = 12;
        private HashSet<ulong> openMenus = new HashSet<ulong>();

        private void Init()
        {
            permission.RegisterPermission(PermissionUse, this);
        }

        [ChatCommand("admin")]
        private void AdminCommand(BasePlayer player, string command, string[] args)
        {
            if (!permission.UserHasPermission(player.UserIDString, PermissionUse))
            {
                player.ChatMessage("You don't have permission to use this command.");
                return;
            }

            // Toggle menu
            if (openMenus.Contains(player.userID))
            {
                CuiHelper.DestroyUi(player, PanelName);
                openMenus.Remove(player.userID);
            }
            else
            {
                ShowAdminMenu(player);
                openMenus.Add(player.userID);
            }
        }

        private void ShowAdminMenu(BasePlayer player)
        {
            var container = new CuiElementContainer();

            // Background panel
            container.Add(new CuiPanel
            {
                Image = { Color = "0 0 0 0.85" },
                RectTransform = { AnchorMin = "0.15 0.1", AnchorMax = "0.85 0.9" },
                CursorEnabled = true
            }, "Hud", PanelName);

            // Title
            container.Add(new CuiLabel
            {
                Text = { Text = "txAdmin Menu", Font = "robotomono.ttf", FontSize = 20, Align = TextAnchor.MiddleCenter, Color = "1 1 1 1" },
                RectTransform = { AnchorMin = "0 0.9", AnchorMax = "1 0.98", OffsetMin = "0 0", OffsetMax = "0 0" }
            }, PanelName);

            // Close button (X)
            container.Add(new CuiButton
            {
                Button = { Color = "0.8 0.2 0.2 0.8", Command = "txadminmenu.close" },
                Text = { Text = "X", FontSize = 16, Align = TextAnchor.MiddleCenter, Color = "1 1 1 1" },
                RectTransform = { AnchorMin = "0.93 0.91", AnchorMax = "0.99 0.97" }
            }, PanelName);

            // Get online players
            var players = BasePlayer.activePlayerList.Take(PlayersPerPage).ToList();
            var totalPlayers = BasePlayer.activePlayerList.Count;

            // Player list header
            container.Add(new CuiLabel
            {
                Text = { Text = $"Players ({players.Count}/{totalPlayers})", FontSize = 12, Align = TextAnchor.MiddleLeft, Color = "1 1 1 0.8" },
                RectTransform = { AnchorMin = "0.05 0.82", AnchorMax = "0.95 0.88" }
            }, PanelName);

            // Player rows
            float rowHeight = 0.06f;
            float startY = 0.80f;
            int rowIndex = 0;

            foreach (var p in players)
            {
                float yMin = startY - (rowIndex + 1) * rowHeight;
                float yMax = yMin + rowHeight - 0.01f;

                // Background for row
                container.Add(new CuiPanel
                {
                    Image = { Color = rowIndex % 2 == 0 ? "0.2 0.2 0.2 0.5" : "0.25 0.25 0.25 0.5" },
                    RectTransform = { AnchorMin = $"0.05 {yMin}", AnchorMax = $"0.95 {yMax}" }
                }, PanelName);

                // Player info text
                string playerInfo = $"{p.displayName} ({p.userID})";
                container.Add(new CuiLabel
                {
                    Text = { Text = playerInfo, FontSize = 11, Align = TextAnchor.MiddleLeft, Color = "1 1 1 1" },
                    RectTransform = { AnchorMin = $"0.08 {yMin}", AnchorMax = $"0.6 {yMax}" }
                }, PanelName);

                // Kick button
                container.Add(new CuiButton
                {
                    Button = { Color = "0.8 0.6 0.2 0.8", Command = $"txadminmenu.kick {p.userID}" },
                    Text = { Text = "Kick", FontSize = 10, Align = TextAnchor.MiddleCenter },
                    RectTransform = { AnchorMin = $"0.62 {yMin}", AnchorMax = $"0.77 {yMax}" }
                }, PanelName);

                // Ban button
                container.Add(new CuiButton
                {
                    Button = { Color = "0.8 0.2 0.2 0.8", Command = $"txadminmenu.ban {p.userID}" },
                    Text = { Text = "Ban", FontSize = 10, Align = TextAnchor.MiddleCenter },
                    RectTransform = { AnchorMin = $"0.79 {yMin}", AnchorMax = $"0.94 {yMax}" }
                }, PanelName);

                rowIndex++;
            }

            CuiHelper.DestroyUi(player, PanelName);
            CuiHelper.AddUi(player, container);
        }

        [ConsoleCommand("txadminmenu.close")]
        private void CloseMenuCommand(ConsoleSystem.Arg arg)
        {
            var player = arg.Player();
            if (player == null) return;

            CuiHelper.DestroyUi(player, PanelName);
            openMenus.Remove(player.userID);
        }

        [ConsoleCommand("txadminmenu.kick")]
        private void KickPlayerCommand(ConsoleSystem.Arg arg)
        {
            var player = arg.Player();
            if (player == null) return;

            if (!permission.UserHasPermission(player.UserIDString, PermissionUse))
            {
                arg.ReplyWith("You don't have permission to use this command.");
                return;
            }

            if (!arg.HasArgs(1))
                return;

            ulong targetUserID;
            if (!ulong.TryParse(arg.GetString(0), out targetUserID))
                return;

            var targetPlayer = BasePlayer.FindByID(targetUserID);
            if (targetPlayer == null)
            {
                arg.ReplyWith("Player not found.");
                return;
            }

            string playerName = targetPlayer.displayName;
            Puts($"[TxAdminMenu] Admin {player.displayName} kicked player {playerName} ({targetUserID})");

            ConsoleSystem.Run(ConsoleSystem.Option.Server, "kick", targetUserID.ToString(), "Kicked by admin");

            // Refresh menu for admin
            if (openMenus.Contains(player.userID))
            {
                ShowAdminMenu(player);
            }
        }

        [ConsoleCommand("txadminmenu.ban")]
        private void BanPlayerCommand(ConsoleSystem.Arg arg)
        {
            var player = arg.Player();
            if (player == null) return;

            if (!permission.UserHasPermission(player.UserIDString, PermissionUse))
            {
                arg.ReplyWith("You don't have permission to use this command.");
                return;
            }

            if (!arg.HasArgs(1))
                return;

            ulong targetUserID;
            if (!ulong.TryParse(arg.GetString(0), out targetUserID))
                return;

            var targetPlayer = BasePlayer.FindByID(targetUserID);
            if (targetPlayer == null)
            {
                arg.ReplyWith("Player not found.");
                return;
            }

            string playerName = targetPlayer.displayName;
            Puts($"[TxAdminMenu] Admin {player.displayName} banned player {playerName} ({targetUserID})");

            ConsoleSystem.Run(ConsoleSystem.Option.Server, "banid", targetUserID.ToString(), playerName, "Banned by admin");
            ConsoleSystem.Run(ConsoleSystem.Option.Server, "server.writecfg");

            // Refresh menu for admin
            if (openMenus.Contains(player.userID))
            {
                ShowAdminMenu(player);
            }
        }

        private void OnPlayerDisconnected(BasePlayer player)
        {
            CuiHelper.DestroyUi(player, PanelName);
            openMenus.Remove(player.userID);
        }

        private void Unload()
        {
            foreach (var player in BasePlayer.activePlayerList)
            {
                CuiHelper.DestroyUi(player, PanelName);
            }
            openMenus.Clear();
        }
    }
}
