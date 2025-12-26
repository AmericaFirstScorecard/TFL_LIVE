(() => {
  const HARDWARE_AWARDS = [
    {
      id: "szn9bowl",
      name: "Szn9Bowl Trophy",
      description: "Season 9 Bowl champions",
      image: "hardware/Szn9Bowl.png",
      recipients: [
        { type: "player", id: "Brump", display: "Brump" },
        { type: "player", id: "Jack", display: "Jack" },
      ],
    },
    {
      id: "mvp",
      name: "MVP",
      description: "Most valuable player honors",
      image: "hardware/MVP.png",
      recipients: [{ type: "player", id: "Brump", display: "Brump" }],
    },
    {
      id: "bandb",
      name: "BandB Trophy",
      description: "BandB rivalry trophy",
      image: "hardware/bandb.png",
      recipients: [{ type: "team", id: "Louisville Cardinals", display: "Louisville Cardinals" }],
    },
    {
      id: "yankdix",
      name: "Yankdix",
      description: "To be awarded",
      image: "hardware/yankdix.png",
      recipients: [],
    },
  ];

  const normalizeKey = (value) => String(value || "").trim().toLowerCase();

  const listHardwareForTeam = (teamKey, normalizeTeamKeyFn) => {
    const normalizeTeam = normalizeTeamKeyFn || normalizeKey;
    const target = normalizeTeam(teamKey);
    return HARDWARE_AWARDS.map((award) => {
      const recipients = (award.recipients || []).filter((rec) => {
        if (rec.type !== "team") return false;
        return normalizeTeam(rec.id) === target;
      });
      const isUnassigned = (award.recipients || []).length === 0;
      return { ...award, recipients, isUnassigned };
    }).filter((award) => award.recipients.length || award.isUnassigned);
  };

  const listHardwareForPlayer = (playerName) => {
    const target = normalizeKey(playerName);
    return HARDWARE_AWARDS.map((award) => {
      const recipients = (award.recipients || []).filter((rec) => {
        if (rec.type !== "player") return false;
        return normalizeKey(rec.id) === target;
      });
      const isUnassigned = (award.recipients || []).length === 0;
      return { ...award, recipients, isUnassigned };
    }).filter((award) => award.recipients.length || award.isUnassigned);
  };

  window.HARDWARE_AWARDS = HARDWARE_AWARDS;
  window.listHardwareForTeam = listHardwareForTeam;
  window.listHardwareForPlayer = listHardwareForPlayer;
})();
