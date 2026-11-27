import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
import { sdk } from '../sdk'

export const v_1_1_3_2 = VersionInfo.of({
  version: '1.1.3:2',
  releaseNotes: {
    en_US:
      "While Paid Access is on, the sign-up page is at /join on the relay's own address, and the relay's address opened in a browser goes there. The Sign-up Page interface is removed, along with any domain added to it: add that domain to the Relay interface to keep its links working.",
    es_ES:
      'Con Acceso de pago activado, la página de registro está en /join en la propia dirección del relay, y la dirección del relay abierta en un navegador lleva a ella. La interfaz Página de registro se elimina, junto con cualquier dominio añadido a ella: añade ese dominio a la interfaz Relay para que sus enlaces sigan funcionando.',
    de_DE:
      'Ist Bezahlter Zugang aktiv, liegt die Anmeldeseite unter /join auf der Adresse des Relays selbst, und die Relay-Adresse führt im Browser dorthin. Die Schnittstelle Anmeldeseite entfällt, samt jeder ihr hinzugefügten Domain: Füge diese Domain der Schnittstelle Relay hinzu, damit ihre Links weiter funktionieren.',
    pl_PL:
      'Gdy Płatny dostęp jest włączony, strona rejestracji jest pod /join na adresie samego przekaźnika, a adres przekaźnika otwarty w przeglądarce prowadzi do niej. Interfejs Strona rejestracji zostaje usunięty wraz z każdą dodaną do niego domeną: dodaj tę domenę do interfejsu Przekaźnik, aby jej linki nadal działały.',
    fr_FR:
      "Quand Accès payant est activé, la page d'inscription se trouve à /join sur l'adresse même du relais, et l'adresse du relais ouverte dans un navigateur y mène. L'interface Page d'inscription est supprimée, avec tout domaine qui lui a été ajouté : ajoutez ce domaine à l'interface Relais pour que ses liens continuent de fonctionner.",
  },
  migrations: {
    up: async ({ effects }) => {
      await sdk.MultiHost.of(effects, 'signup-multi').retire()
    },
    down: IMPOSSIBLE,
  },
})
