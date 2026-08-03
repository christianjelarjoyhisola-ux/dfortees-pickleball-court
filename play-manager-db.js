(() => {
  "use strict";

  const db = window.DB;
  const supabaseClient = window._supabase;
  if (!db) throw new Error("Play Manager requires the D'fortees data adapter.");

  const LOCAL_STORE_KEY = "df_local_db_v1";
  const RANKING_MODES = new Set(["performance", "win_percentage", "competitive"]);
  const nowIso = () => new Date().toISOString();
  const asId = value => String(value ?? "");
  const normalizeRankingMode = value => RANKING_MODES.has(String(value || ""))
    ? String(value)
    : "competitive";
  const normalizeSkillLevel = value => {
    const level = Math.round(Number(value));
    return Number.isFinite(level) ? Math.min(6, Math.max(1, level)) : 1;
  };
  const performanceSeed = level => 1000 + (normalizeSkillLevel(level) - 1) * 100;
  const rpcResult = data => Array.isArray(data) ? (data[0] ?? null) : data;

  function sessionRow(session) {
    return {
      date: session.date,
      time_label: session.timeLabel || null,
      court_ids: session.courtIds || [],
      court_names: session.courtNames || [],
      mode: session.mode || "adaptive_competitive_mixer",
      ranking_mode: normalizeRankingMode(session.rankingMode ?? session.ranking_mode),
      status: session.status || "draft",
      current_round: Number(session.currentRound || 0),
      location: session.location || null,
      settings: session.settings || {},
      share_enabled: session.shareEnabled !== false,
      performance_rating_version: "pr-performance-v1",
      performance_rating_k: 24,
      performance_rating_scale: 400,
      performance_rating_min_games: 2,
    };
  }

  function playerRow(sessionId, player, seedOrder) {
    const skillLevel = normalizeSkillLevel(player.skillLevel ?? player.skill_level);
    return {
      session_id: sessionId,
      full_name: String(player.fullName ?? player.full_name ?? "").trim(),
      source_registration_id: player.sourceRegistrationId ?? player.source_registration_id ?? null,
      status: player.status || "active",
      seed_order: Number(player.seedOrder ?? player.seed_order ?? seedOrder ?? 0),
      profile: player.profile || {},
      skill_level: skillLevel,
      performance_seed_rating: performanceSeed(skillLevel),
    };
  }

  async function rpc(name, parameters) {
    const { data, error } = await supabaseClient.rpc(name, parameters);
    if (error) {
      console.error(`${name}:`, error);
      throw error;
    }
    return data;
  }

  const remoteMethods = {
    async getOpenPlayGameSessions() {
      const { data, error } = await supabaseClient
        .from("open_play_game_sessions")
        .select("*")
        .order("date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },

    async createOpenPlayGameSession(session) {
      const { data, error } = await supabaseClient
        .from("open_play_game_sessions")
        .insert(sessionRow(session))
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },

    async updateOpenPlayGameSession(id, updates) {
      const row = {};
      if (updates.date !== undefined) row.date = updates.date;
      if (updates.timeLabel !== undefined) row.time_label = updates.timeLabel || null;
      if (updates.courtIds !== undefined) row.court_ids = updates.courtIds || [];
      if (updates.courtNames !== undefined) row.court_names = updates.courtNames || [];
      if (updates.mode !== undefined) row.mode = updates.mode;
      if (updates.rankingMode !== undefined || updates.ranking_mode !== undefined) {
        row.ranking_mode = normalizeRankingMode(updates.rankingMode ?? updates.ranking_mode);
      }
      if (updates.status !== undefined) row.status = updates.status;
      if (updates.currentRound !== undefined) row.current_round = Number(updates.currentRound || 0);
      if (updates.location !== undefined) row.location = updates.location || null;
      if (updates.settings !== undefined) row.settings = updates.settings || {};
      if (updates.shareEnabled !== undefined) row.share_enabled = Boolean(updates.shareEnabled);
      const { data, error } = await supabaseClient
        .from("open_play_game_sessions")
        .update(row)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },

    async getOpenPlayGamePlayers(sessionId) {
      const { data, error } = await supabaseClient
        .from("open_play_game_players")
        .select("*")
        .eq("session_id", sessionId)
        .order("seed_order");
      if (error) throw error;
      return data || [];
    },

    async replaceOpenPlayGamePlayers(sessionId, players) {
      const { error: deleteError } = await supabaseClient
        .from("open_play_game_players")
        .delete()
        .eq("session_id", sessionId);
      if (deleteError) throw deleteError;
      if (!players.length) return [];
      const rows = players.map((player, index) => playerRow(sessionId, player, index));
      const { data, error } = await supabaseClient
        .from("open_play_game_players")
        .insert(rows)
        .select("*")
        .order("seed_order");
      if (error) throw error;
      return data || [];
    },

    async addOpenPlayGamePlayer(sessionId, player) {
      const { data, error } = await supabaseClient
        .from("open_play_game_players")
        .insert(playerRow(sessionId, player, player.seedOrder || 0))
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },

    async updateOpenPlayGamePlayer(id, updates) {
      const row = {};
      if (updates.fullName !== undefined || updates.full_name !== undefined) {
        row.full_name = String(updates.fullName ?? updates.full_name).trim();
      }
      if (updates.skillLevel !== undefined || updates.skill_level !== undefined) {
        row.skill_level = normalizeSkillLevel(updates.skillLevel ?? updates.skill_level);
      }
      const { data, error } = await supabaseClient
        .from("open_play_game_players")
        .update(row)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },

    async getOpenPlayGameRounds(sessionId) {
      const { data, error } = await supabaseClient
        .from("open_play_game_rounds")
        .select("*")
        .eq("session_id", sessionId)
        .order("round_no");
      if (error) throw error;
      return data || [];
    },

    async addOpenPlayGameRound(round) {
      const data = await rpc("add_open_play_game_round", {
        p_session_id: round.sessionId,
        p_round_no: Number(round.roundNo),
        p_assignments: round.assignments || [],
        p_queue_snapshot: round.queueSnapshot || [],
        p_partner_history: round.partnerHistory || {},
        p_opponent_history: round.opponentHistory || {},
        p_completed_at: round.completedAt || null,
      });
      return rpcResult(data);
    },

    async updateOpenPlayGameRound(id, updates, expected) {
      if (expected) return this.updateOpenPlayGameRoundIfCurrent(id, expected, updates);
      const row = {};
      if (updates.assignments !== undefined) row.assignments = updates.assignments;
      if (updates.queueSnapshot !== undefined) row.queue_snapshot = updates.queueSnapshot;
      if (updates.partnerHistory !== undefined) row.partner_history = updates.partnerHistory;
      if (updates.opponentHistory !== undefined) row.opponent_history = updates.opponentHistory;
      if (updates.completedAt !== undefined) row.completed_at = updates.completedAt;
      const { data, error } = await supabaseClient
        .from("open_play_game_rounds")
        .update(row)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },

    async updateOpenPlayGameRoundIfCurrent(id, expected, updates) {
      return rpc("update_open_play_game_round_if_current", {
        p_round_id: id,
        p_expected_assignments: expected.assignments || [],
        p_expected_queue_snapshot: expected.queueSnapshot ?? expected.queue_snapshot ?? [],
        p_assignments: updates.assignments || [],
        p_queue_snapshot: updates.queueSnapshot ?? updates.queue_snapshot ?? [],
      });
    },

    async replaceOpenPlayGameCourtPlayer(id, expected, replacement) {
      return rpc("replace_open_play_game_court_player", {
        p_round_id: id,
        p_expected_assignments: expected.assignments || [],
        p_expected_queue_snapshot: expected.queueSnapshot ?? expected.queue_snapshot ?? [],
        p_court_index: Number(replacement.courtIndex),
        p_team: replacement.team,
        p_slot_index: Number(replacement.slotIndex),
        p_outgoing_player_id: replacement.outgoingPlayerId,
        p_incoming_player_id: replacement.incomingPlayerId || null,
        p_incoming_player_name: replacement.incomingPlayerName || null,
        p_mark_outgoing_removed: replacement.markOutgoingRemoved === true,
      });
    },

    async correctOpenPlayGameMatchWinner(id, expected, correction) {
      return rpc("correct_open_play_game_match_winner", {
        p_round_id: id,
        p_expected_assignments: expected.assignments || [],
        p_court_index: Number(correction.courtIndex),
        p_completed_game_index: correction.completedGameIndex ?? null,
        p_expected_winner: correction.expectedWinner,
        p_new_winner: correction.newWinner,
      });
    },

    async syncOpenPlayGameQueueWaitTimes(sessionId, queuePlayerIds) {
      return (await rpc("sync_open_play_game_queue_wait_times", {
        p_session_id: sessionId,
        p_queue_player_ids: (queuePlayerIds || []).map(String),
      })) || [];
    },

    async setOpenPlayGamePublicShare(sessionId, enabled) {
      return rpc("set_open_play_game_public_share", {
        p_session_id: sessionId,
        p_enabled: Boolean(enabled),
      });
    },

    async rotateOpenPlayGamePublicShare(sessionId) {
      return rpc("rotate_open_play_game_public_share", { p_session_id: sessionId });
    },

    async getPublicOpenPlayGameLiveBoard(shareToken) {
      const token = String(shareToken || "").trim();
      if (!/^[0-9a-f]{64}$/.test(token)) return null;
      return rpc("get_public_open_play_game_live_board", { p_share_token: token });
    },
  };

  function readLocalDb() {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_STORE_KEY) || "{}");
    parsed.openPlayGameSessions = Array.isArray(parsed.openPlayGameSessions) ? parsed.openPlayGameSessions : [];
    parsed.openPlayGamePlayers = Array.isArray(parsed.openPlayGamePlayers) ? parsed.openPlayGamePlayers : [];
    parsed.openPlayGameRounds = Array.isArray(parsed.openPlayGameRounds) ? parsed.openPlayGameRounds : [];
    return parsed;
  }

  function writeLocalDb(value) {
    localStorage.setItem(LOCAL_STORE_KEY, JSON.stringify(value));
  }

  function localId() {
    return crypto.randomUUID();
  }

  function randomShareToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  }

  function sameJson(left, right) {
    return JSON.stringify(left || []) === JSON.stringify(right || []);
  }

  function completedMatches(rounds) {
    const matches = [];
    (rounds || []).forEach(round => {
      (round.assignments || []).forEach((game, courtIndex) => {
        (game.completedGames || []).forEach((saved, completedGameIndex) => {
          if (["A", "B"].includes(saved.winner)) {
            matches.push({ ...saved, roundNo: round.round_no, courtIndex, completedGameIndex });
          }
        });
        if (["A", "B"].includes(game.winner)) {
          matches.push({ ...game, roundNo: round.round_no, courtIndex, completedGameIndex: null });
        }
      });
    });
    return matches;
  }

  function mapGameNames(game, names) {
    const mapTeam = team => (team || []).map(id => names.get(asId(id)) || "Player");
    return {
      ...game,
      teamA: mapTeam(game.teamA),
      teamB: mapTeam(game.teamB),
      completedGames: (game.completedGames || []).map(saved => ({
        ...saved,
        teamA: mapTeam(saved.teamA),
        teamB: mapTeam(saved.teamB),
      })),
      ...(game.readyMatch ? {
        readyMatch: {
          ...game.readyMatch,
          teamA: mapTeam(game.readyMatch.teamA),
          teamB: mapTeam(game.readyMatch.teamB),
        },
      } : {}),
    };
  }

  function localLiveBoard(localDb, session) {
    const players = localDb.openPlayGamePlayers
      .filter(player => asId(player.session_id) === asId(session.id));
    const activePlayers = players.filter(player => player.status === "active");
    const rounds = localDb.openPlayGameRounds
      .filter(round => asId(round.session_id) === asId(session.id))
      .sort((left, right) => Number(left.round_no) - Number(right.round_no));
    const latest = rounds.at(-1) || null;
    const names = new Map(players.map(player => [asId(player.id), player.full_name]));
    const matches = completedMatches(rounds);
    const mode = normalizeRankingMode(session.ranking_mode);
    const standings = window.PBOpenPlayRating?.calculateStandings?.(activePlayers, matches, {
      mode,
      minGames: Number(session.performance_rating_min_games || 2),
    }) || [];
    const result = [...matches].sort((left, right) =>
      Date.parse(right.resultAt || "") - Date.parse(left.resultAt || "")
    )[0] || null;
    const latestResult = result ? {
      ...result,
      teamA: (result.teamA || []).map(id => names.get(asId(id)) || "Player"),
      teamB: (result.teamB || []).map(id => names.get(asId(id)) || "Player"),
    } : null;
    return {
      generatedAt: nowIso(),
      session: {
        date: session.date,
        timeLabel: session.time_label,
        courtNames: session.court_names || [],
        status: session.status,
        currentRound: latest?.round_no || session.current_round || 0,
      },
      players: activePlayers.map(player => player.full_name),
      latestRound: latest ? {
        roundNo: latest.round_no,
        assignments: (latest.assignments || []).map(game => mapGameNames(game, names)),
        queue: (latest.queue_snapshot || []).map(id => names.get(asId(id))).filter(Boolean),
      } : null,
      standings,
      resultCount: matches.length,
      latestResult,
      ratingSystem: {
        mode,
        name: mode === "competitive"
          ? "Competitive Ranking"
          : mode === "win_percentage"
            ? "Individual Win Percentage"
            : "Individual Performance Rating",
        version: mode === "competitive" ? "competitive-ranking-v2" : mode,
        minGames: Number(session.performance_rating_min_games || 2),
        rankingMetric: mode === "performance" ? "session_points" : mode,
      },
    };
  }

  const localMethods = {
    async getOpenPlayGameSessions() {
      return readLocalDb().openPlayGameSessions.sort((left, right) =>
        String(right.date || "").localeCompare(String(left.date || ""))
      );
    },

    async createOpenPlayGameSession(session) {
      const localDb = readLocalDb();
      const row = { id: localId(), ...sessionRow(session), created_at: nowIso(), updated_at: nowIso() };
      localDb.openPlayGameSessions.unshift(row);
      writeLocalDb(localDb);
      return row;
    },

    async updateOpenPlayGameSession(id, updates) {
      const localDb = readLocalDb();
      let saved = null;
      localDb.openPlayGameSessions = localDb.openPlayGameSessions.map(session => {
        if (asId(session.id) !== asId(id)) return session;
        saved = {
          ...session,
          date: updates.date ?? session.date,
          time_label: updates.timeLabel !== undefined ? updates.timeLabel : session.time_label,
          court_ids: updates.courtIds ?? session.court_ids,
          court_names: updates.courtNames ?? session.court_names,
          mode: updates.mode ?? session.mode,
          ranking_mode: updates.rankingMode !== undefined
            ? normalizeRankingMode(updates.rankingMode)
            : session.ranking_mode,
          status: updates.status ?? session.status,
          current_round: updates.currentRound ?? session.current_round,
          share_enabled: updates.shareEnabled !== undefined
            ? Boolean(updates.shareEnabled)
            : session.share_enabled,
          updated_at: nowIso(),
        };
        return saved;
      });
      writeLocalDb(localDb);
      return saved;
    },

    async getOpenPlayGamePlayers(sessionId) {
      return readLocalDb().openPlayGamePlayers
        .filter(player => asId(player.session_id) === asId(sessionId))
        .sort((left, right) => Number(left.seed_order) - Number(right.seed_order));
    },

    async replaceOpenPlayGamePlayers(sessionId, players) {
      const localDb = readLocalDb();
      localDb.openPlayGamePlayers = localDb.openPlayGamePlayers
        .filter(player => asId(player.session_id) !== asId(sessionId));
      const rows = players.map((player, index) => ({
        id: localId(),
        ...playerRow(sessionId, player, index),
        queue_entered_at: nowIso(),
        created_at: nowIso(),
      }));
      localDb.openPlayGamePlayers.push(...rows);
      writeLocalDb(localDb);
      return rows;
    },

    async addOpenPlayGamePlayer(sessionId, player) {
      const localDb = readLocalDb();
      const row = {
        id: localId(),
        ...playerRow(sessionId, player, player.seedOrder || 0),
        queue_entered_at: nowIso(),
        created_at: nowIso(),
      };
      localDb.openPlayGamePlayers.push(row);
      writeLocalDb(localDb);
      return row;
    },

    async updateOpenPlayGamePlayer(id, updates) {
      const localDb = readLocalDb();
      let saved = null;
      localDb.openPlayGamePlayers = localDb.openPlayGamePlayers.map(player => {
        if (asId(player.id) !== asId(id)) return player;
        const skillLevel = updates.skillLevel ?? updates.skill_level;
        saved = {
          ...player,
          full_name: updates.fullName ?? updates.full_name ?? player.full_name,
          skill_level: skillLevel === undefined ? player.skill_level : normalizeSkillLevel(skillLevel),
        };
        return saved;
      });
      writeLocalDb(localDb);
      return saved;
    },

    async getOpenPlayGameRounds(sessionId) {
      return readLocalDb().openPlayGameRounds
        .filter(round => asId(round.session_id) === asId(sessionId))
        .sort((left, right) => Number(left.round_no) - Number(right.round_no));
    },

    async addOpenPlayGameRound(round) {
      const localDb = readLocalDb();
      const row = {
        id: localId(),
        session_id: round.sessionId,
        round_no: Number(round.roundNo),
        assignments: round.assignments || [],
        queue_snapshot: round.queueSnapshot || [],
        partner_history: round.partnerHistory || {},
        opponent_history: round.opponentHistory || {},
        completed_at: round.completedAt || null,
        created_at: nowIso(),
      };
      localDb.openPlayGameRounds.push(row);
      localDb.openPlayGameSessions = localDb.openPlayGameSessions.map(session =>
        asId(session.id) === asId(round.sessionId)
          ? { ...session, status: "active", current_round: row.round_no, updated_at: nowIso() }
          : session
      );
      writeLocalDb(localDb);
      return row;
    },

    async updateOpenPlayGameRound(id, updates, expected) {
      return this.updateOpenPlayGameRoundIfCurrent(id, expected, updates);
    },

    async updateOpenPlayGameRoundIfCurrent(id, expected, updates) {
      const localDb = readLocalDb();
      let saved = null;
      localDb.openPlayGameRounds = localDb.openPlayGameRounds.map(round => {
        if (asId(round.id) !== asId(id)) return round;
        if (!sameJson(round.assignments, expected.assignments) ||
            !sameJson(round.queue_snapshot, expected.queueSnapshot ?? expected.queue_snapshot)) {
          const conflict = new Error("PLAY_MANAGER_ROUND_CONFLICT");
          conflict.code = "40001";
          throw conflict;
        }
        saved = {
          ...round,
          assignments: updates.assignments ?? round.assignments,
          queue_snapshot: updates.queueSnapshot ?? updates.queue_snapshot ?? round.queue_snapshot,
        };
        return saved;
      });
      writeLocalDb(localDb);
      return saved;
    },

    async replaceOpenPlayGameCourtPlayer(id, expected, replacement) {
      const localDb = readLocalDb();
      const round = localDb.openPlayGameRounds.find(item => asId(item.id) === asId(id));
      if (!round || !sameJson(round.assignments, expected.assignments) ||
          !sameJson(round.queue_snapshot, expected.queueSnapshot ?? expected.queue_snapshot)) {
        const conflict = new Error("PLAY_MANAGER_ROUND_CONFLICT");
        conflict.code = "40001";
        throw conflict;
      }
      let incomingPlayer = null;
      let incomingId = replacement.incomingPlayerId ? asId(replacement.incomingPlayerId) : "";
      if (!incomingId && replacement.incomingPlayerName) {
        incomingPlayer = {
          id: localId(),
          ...playerRow(round.session_id, {
            fullName: replacement.incomingPlayerName,
            status: "active",
            skillLevel: 1,
          }, localDb.openPlayGamePlayers.length),
          queue_entered_at: nowIso(),
          created_at: nowIso(),
        };
        incomingId = incomingPlayer.id;
        localDb.openPlayGamePlayers.push(incomingPlayer);
      }
      const courtIndex = Number(replacement.courtIndex);
      const teamKey = replacement.team === "B" ? "teamB" : "teamA";
      const assignments = round.assignments.map((game, index) => {
        if (index !== courtIndex) return game;
        const team = [...(game[teamKey] || [])];
        if (asId(team[Number(replacement.slotIndex)]) !== asId(replacement.outgoingPlayerId)) {
          const conflict = new Error("PLAY_MANAGER_ROUND_CONFLICT");
          conflict.code = "40001";
          throw conflict;
        }
        team[Number(replacement.slotIndex)] = incomingId;
        return { ...game, [teamKey]: team };
      });
      const queue = (round.queue_snapshot || []).filter(playerId => asId(playerId) !== incomingId);
      if (!replacement.markOutgoingRemoved) queue.push(asId(replacement.outgoingPlayerId));
      if (replacement.markOutgoingRemoved) {
        localDb.openPlayGamePlayers = localDb.openPlayGamePlayers.map(player =>
          asId(player.id) === asId(replacement.outgoingPlayerId)
            ? { ...player, status: "removed" }
            : player
        );
      }
      const saved = { ...round, assignments, queue_snapshot: [...new Set(queue)] };
      localDb.openPlayGameRounds = localDb.openPlayGameRounds.map(item =>
        asId(item.id) === asId(id) ? saved : item
      );
      writeLocalDb(localDb);
      return { round: saved, incoming_player: incomingPlayer };
    },

    async correctOpenPlayGameMatchWinner(id, expected, correction) {
      const localDb = readLocalDb();
      const round = localDb.openPlayGameRounds.find(item => asId(item.id) === asId(id));
      if (!round || !sameJson(round.assignments, expected.assignments)) {
        const conflict = new Error("PLAY_MANAGER_ROUND_CONFLICT");
        conflict.code = "40001";
        throw conflict;
      }
      const assignments = round.assignments.map((game, courtIndex) => {
        if (courtIndex !== Number(correction.courtIndex)) return game;
        if (correction.completedGameIndex == null) {
          return { ...game, winner: correction.newWinner, correctedAt: nowIso() };
        }
        return {
          ...game,
          completedGames: (game.completedGames || []).map((saved, index) =>
            index === Number(correction.completedGameIndex)
              ? { ...saved, winner: correction.newWinner, correctedAt: nowIso() }
              : saved
          ),
        };
      });
      const saved = { ...round, assignments };
      localDb.openPlayGameRounds = localDb.openPlayGameRounds.map(item =>
        asId(item.id) === asId(id) ? saved : item
      );
      writeLocalDb(localDb);
      return saved;
    },

    async syncOpenPlayGameQueueWaitTimes(sessionId, queuePlayerIds) {
      const localDb = readLocalDb();
      const queued = new Set((queuePlayerIds || []).map(asId));
      localDb.openPlayGamePlayers = localDb.openPlayGamePlayers.map(player => {
        if (asId(player.session_id) !== asId(sessionId)) return player;
        if (!queued.has(asId(player.id))) return { ...player, queue_entered_at: null };
        return { ...player, queue_entered_at: player.queue_entered_at || nowIso() };
      });
      writeLocalDb(localDb);
      return localDb.openPlayGamePlayers.filter(player => asId(player.session_id) === asId(sessionId));
    },

    async setOpenPlayGamePublicShare(sessionId, enabled) {
      const localDb = readLocalDb();
      let token = null;
      localDb.openPlayGameSessions = localDb.openPlayGameSessions.map(session => {
        if (asId(session.id) !== asId(sessionId)) return session;
        token = enabled ? (session.local_share_token || randomShareToken()) : null;
        return {
          ...session,
          share_enabled: Boolean(enabled),
          local_share_token: token,
          updated_at: nowIso(),
        };
      });
      writeLocalDb(localDb);
      return token;
    },

    async rotateOpenPlayGamePublicShare(sessionId) {
      const localDb = readLocalDb();
      const token = randomShareToken();
      localDb.openPlayGameSessions = localDb.openPlayGameSessions.map(session =>
        asId(session.id) === asId(sessionId)
          ? { ...session, share_enabled: true, local_share_token: token, updated_at: nowIso() }
          : session
      );
      writeLocalDb(localDb);
      return token;
    },

    async getPublicOpenPlayGameLiveBoard(shareToken) {
      const token = String(shareToken || "").trim();
      if (!/^[0-9a-f]{64}$/.test(token)) return null;
      const localDb = readLocalDb();
      const session = localDb.openPlayGameSessions.find(item =>
        item.share_enabled !== false && item.local_share_token === token
      );
      return session ? localLiveBoard(localDb, session) : null;
    },
  };

  if (window.PB_USE_LOCAL_DATA) {
    Object.assign(db, localMethods);
  } else {
    if (!supabaseClient) throw new Error("Play Manager requires Supabase.");
    Object.assign(db, remoteMethods);
  }
})();
