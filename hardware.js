(() => {
  const HARDWARE_AWARDS = [
    {
      id: "szn9bowl",
      name: "Szn9bowl Trophy",
      description: "Super Bowl 9 winners",
      image: "hardware/Szn9Bowl.png",
      recipients: [
        { type: "player", id: "Brump", display: "Brump" },
        { type: "player", id: "Jack", display: "Jack" },
      ],
    },
    {
      id: "mvp",
      name: "MVP",
      description: "Most Valuable Player",
      image: "hardware/MVP.png",
      recipients: [{ type: "player", id: "Brump", display: "Brump" }],
    },
    {
      id: "bandb",
      name: "Bourbon and Boots Trophy",
      description: "Bourbon and Boots rivalry trophy",
      image: "hardware/bandb.png",
      recipients: [{ type: "team", id: "Louisville Cardinals", display: "Louisville Cardinals" }],
    },
    {
      id: "dixie-yankee",
      name: "Dixie and Yankee Rivalry Trophy",
      description: "To be awarded",
      image: "hardware/yankdix.png",
      recipients: ["New England Patriots"],
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
